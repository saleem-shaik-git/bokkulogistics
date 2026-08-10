import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import {
  deliveries,
  stores,
  type DatabaseConnection,
  type Delivery,
  type Order,
  type User,
} from '@bokku/database';
import type { DeliveryStatus, OrderStatus, PublicDeliveryTracking } from '@bokku/shared';

import { DRIZZLE_CLIENT, DELIVERY_PROVIDER } from '../../config/constants';
import { AuditService } from '../audit/audit.module';
import {
  DeliveryIntegrationError,
  type CreateDeliveryInput,
  type DeliveryProvider,
  type DeliveryTracking,
} from '../../integrations/delivery/delivery-provider.interface';
import { NotificationsService } from '../notifications/notifications.service';
import { OrderStatePolicy } from '../orders/order-state.policy';
import { OrdersService } from '../orders/orders.service';

/** Order status each courier stage maps to (progress is monotonic). */
const STAGE_TO_ORDER_STATUS: Partial<Record<DeliveryStatus, OrderStatus>> = {
  REQUESTED: 'DELIVERY_REQUESTED',
  DRIVER_ASSIGNED: 'DRIVER_ASSIGNED',
  DRIVER_ARRIVING: 'DRIVER_ASSIGNED',
  PICKED_UP: 'OUT_FOR_DELIVERY',
  IN_TRANSIT: 'OUT_FOR_DELIVERY',
  DELIVERED: 'DELIVERED',
};

/** Order chain for fast-forwarding (each edge individually policy-checked). */
const ORDER_CHAIN: readonly OrderStatus[] = [
  'DELIVERY_REQUESTED',
  'DRIVER_ASSIGNED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
];

/**
 * Deliveries — the bridge between orders and the DeliveryProvider interface
 * (spec: orders never talk to Uber/Bolt directly; only this service sees
 * both sides).
 *
 * Dispatch is triggered when staff marks an order READY_FOR_PICKUP (and is
 * retryable via POST /bokku/orders/:id/dispatch). Status progression is
 * polling-first: every tracking read syncs the provider state forward,
 * applying each legal SYSTEM transition (fast-forward semantics) — the
 * final DELIVERED step settles the stock reservation transactionally.
 */
@Injectable()
export class DeliveriesService {
  private readonly logger = new Logger(DeliveriesService.name);

  constructor(
    @Inject(DRIZZLE_CLIENT) private readonly database: DatabaseConnection,
    @Inject(DELIVERY_PROVIDER) private readonly provider: DeliveryProvider,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  // ── Dispatch ────────────────────────────────────────────────────

  /**
   * Create the provider delivery for an order and move it to
   * DELIVERY_REQUESTED. Idempotent on the order's unique delivery —
   * retries (or the auto-dispatch firing after a manual retry) converge.
   */
  async dispatchForOrder(orderId: string, actor: User | null): Promise<Delivery> {
    const existing = await this.findByOrderId(orderId);
    if (existing) return existing;

    const order = await this.orders.getRowById(orderId);
    if (order.status !== 'READY_FOR_PICKUP') {
      throw new ConflictException({
        code: 'DELIVERY_NOT_DISPATCHABLE',
        message: `A delivery can only be dispatched once the order is READY_FOR_PICKUP (it is ${order.status})`,
      });
    }

    const [store] = await this.database.db
      .select()
      .from(stores)
      .where(eq(stores.id, order.storeId))
      .limit(1);
    if (!store) {
      throw new ConflictException({
        code: 'DELIVERY_NOT_DISPATCHABLE',
        message: 'The store for this order no longer exists',
      });
    }

    const quote = order.deliveryQuote as { quoteId?: string };
    const address = order.deliveryAddress as {
      label?: string;
      street?: string;
      city?: string;
      state?: string;
      latitude?: number | null;
      longitude?: number | null;
    };
    const input: CreateDeliveryInput = {
      quoteId: quote.quoteId,
      reference: order.orderNumber,
      pickup: {
        address: `${store.address}, ${store.city}, ${store.state}`,
        latitude: store.latitude === null ? null : Number(store.latitude),
        longitude: store.longitude === null ? null : Number(store.longitude),
      },
      dropoff: {
        address: `${address.street ?? ''}, ${address.city ?? ''}, ${address.state ?? ''}`,
        latitude: address.latitude ?? null,
        longitude: address.longitude ?? null,
      },
    };

    let externalId: string;
    try {
      const created = await this.provider.createDelivery(input);
      externalId = created.deliveryId;
    } catch (error) {
      // Provider outage / not-configured: surface as a conflict-class API
      // error and record why the dispatch could not happen.
      await this.audit.record({
        actorUserId: actor?.id,
        action: 'delivery.dispatch_failed',
        entityType: 'order',
        entityId: order.id,
        metadata: {
          orderNumber: order.orderNumber,
          reason: error instanceof Error ? error.message : 'provider error',
          code: (error as { code?: string }).code ?? 'UNKNOWN',
        },
      });
      this.providerError(error);
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const [row] = await this.database.db
          .insert(deliveries)
          .values({
            orderId: order.id,
            provider: this.provider.kind,
            externalId,
            status: 'REQUESTED',
            quoteId: input.quoteId ?? null,
            pickup: input.pickup,
            dropoff: input.dropoff,
          })
          .returning();
        await this.orders.transitionSystem(order.id, 'DELIVERY_REQUESTED', {
          provider: this.provider.kind,
          externalId,
        });
        await this.audit.record({
          actorUserId: actor?.id,
          action: 'delivery.dispatched',
          entityType: 'order',
          entityId: order.id,
          metadata: { orderNumber: order.orderNumber, provider: this.provider.kind, externalId },
        });
        await this.notifications.emit(order.userId, {
          type: 'delivery.dispatched',
          title: 'Courier requested',
          body: `We're finding a rider for order ${order.orderNumber}.`,
          data: { orderId: order.id, orderNumber: order.orderNumber, externalId },
        });
        return row!;
      } catch (error) {
        if (attempt === 0 && this.pgConstraint(error, 'deliveries_order_unique')) {
          // Lost a concurrent dispatch race — the winner's row is canonical.
          const winner = await this.findByOrderId(orderId);
          if (winner) return winner;
          continue;
        }
        throw error;
      }
    }
    const winner = await this.findByOrderId(orderId);
    if (winner) return winner;
    throw new ConflictException({
      code: 'DELIVERY_DISPATCH_FAILED',
      message: 'The delivery could not be recorded — retry dispatching',
    });
  }

  /** Customer-facing courier-stage notifications (DRIVER_ASSIGNED keeps the courier name). */
  private async emitStageNotification(
    step: OrderStatus,
    order: Order,
    courier: DeliveryTracking['courier'],
  ): Promise<void> {
    if (step === 'DRIVER_ASSIGNED') {
      const who = courier?.name ?? 'A rider';
      await this.notifications.emit(order.userId, {
        type: 'delivery.driver_assigned',
        title: 'Rider assigned',
        body: `${who} is heading to the store for order ${order.orderNumber}.`,
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          ...(courier ? { courier } : {}),
        },
      });
    } else if (step === 'OUT_FOR_DELIVERY') {
      await this.notifications.emit(order.userId, {
        type: 'delivery.out_for_delivery',
        title: 'On the way',
        body: `Order ${order.orderNumber} is on its way to you.`,
        data: { orderId: order.id, orderNumber: order.orderNumber },
      });
    }
  }

  // ── Sync (polling-first progression) ────────────────────────────

  /**
   * Pull the provider status for the order's delivery and fast-forward the
   * order + delivery rows to match. No-op when there is no delivery yet or
   * it is already terminal. Safe to call on every read.
   */
  async syncForOrder(orderId: string): Promise<Delivery | null> {
    const [delivery] = await this.database.db
      .select()
      .from(deliveries)
      .where(eq(deliveries.orderId, orderId))
      .limit(1);
    if (!delivery || delivery.status === 'DELIVERED' || delivery.status === 'CANCELLED') {
      return delivery ?? null;
    }

    let status: Awaited<ReturnType<DeliveryProvider['getDeliveryStatus']>>;
    let courier: DeliveryTracking['courier'] = null;
    try {
      status = await this.provider.getDeliveryStatus(delivery.externalId);
      // Courier identity becomes visible from DRIVER_ASSIGNED onwards.
      if (!['REQUESTED', 'CANCELLED'].includes(status.status)) {
        courier = (await this.provider.getTracking(delivery.externalId)).courier;
      }
    } catch (error) {
      // Sync never breaks order reads (expired mock record, provider hiccup).
      this.logger.warn(
        `Delivery sync skipped for ${delivery.externalId}: ${(error as Error).message}`,
      );
      return delivery;
    }
    if (status.status === 'CANCELLED') {
      // Courier-side cancellation we did not initiate: record it and leave
      // the order for ops (never silently cancel a paid order).
      const [updated] = await this.database.db
        .update(deliveries)
        .set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() })
        .where(eq(deliveries.id, delivery.id))
        .returning();
      this.logger.warn(`Provider cancelled ${delivery.externalId} for order ${orderId} — ops must follow up`);
      return updated ?? delivery;
    }

    // Courier identity becomes visible from DRIVER_ASSIGNED onwards.

    const target = STAGE_TO_ORDER_STATUS[status.status] ?? null;
    const order = await this.orders.getRowById(orderId);
    const currentIdx = ORDER_CHAIN.indexOf(order.status);
    if (target && currentIdx !== -1) {
      const targetIdx = ORDER_CHAIN.indexOf(target);
      for (let i = currentIdx + 1; i <= targetIdx; i += 1) {
        const step = ORDER_CHAIN[i]!;
        if (step === 'DELIVERED') {
          await this.orders.completeDelivery(orderId); // settles the reservation
          await this.notifications.emit(order.userId, {
            type: 'delivery.delivered',
            title: 'Delivered',
            body: `Order ${order.orderNumber} was delivered. Enjoy!`,
            data: { orderId, orderNumber: order.orderNumber },
          });
        } else {
          OrderStatePolicy.assertTransition('SYSTEM', ORDER_CHAIN[i - 1] as OrderStatus, step);
          await this.orders.transitionSystem(orderId, step, {
            provider: this.provider.kind,
            providerStatus: status.status,
          });
          await this.emitStageNotification(step, order, courier);
        }
      }
    }

    const terminalUpdate: Partial<typeof deliveries.$inferInsert> = {};
    if (status.status === 'DELIVERED') terminalUpdate.deliveredAt = new Date();
    const [updated] = await this.database.db
      .update(deliveries)
      .set({
        status: status.status,
        ...(courier ? { courier } : {}),
        ...terminalUpdate,
        updatedAt: new Date(),
      })
      .where(eq(deliveries.id, delivery.id))
      .returning();
    return updated ?? delivery;
  }

  // ── Cancel through the provider ─────────────────────────────────

  /**
   * Cancel the courier for an order's delivery (staff cancellation path —
   * called BEFORE the order's own cancel/refund flow runs).
   */
  async cancelThroughProvider(orderId: string, reason: string | undefined, actor: User): Promise<void> {
    const delivery = await this.findByOrderId(orderId);
    if (!delivery || delivery.status === 'DELIVERED' || delivery.status === 'CANCELLED') return;

    let result: Awaited<ReturnType<DeliveryProvider['cancelDelivery']>>;
    try {
      result = await this.provider.cancelDelivery(delivery.externalId);
    } catch (error) {
      this.providerError(error);
    }
    await this.database.db
      .update(deliveries)
      .set({
        status: result.status,
        cancelledAt: new Date(),
        cancelReason: reason ?? null,
        updatedAt: new Date(),
      })
      .where(eq(deliveries.id, delivery.id));
    await this.audit.record({
      actorUserId: actor.id,
      action: 'delivery.cancelled',
      entityType: 'order',
      entityId: orderId,
      metadata: {
        provider: this.provider.kind,
        externalId: delivery.externalId,
        ...(reason ? { reason } : {}),
      },
    });
  }

  // ── Reads ───────────────────────────────────────────────────────

  async findByOrderId(orderId: string): Promise<Delivery | null> {
    const [row] = await this.database.db
      .select()
      .from(deliveries)
      .where(eq(deliveries.orderId, orderId))
      .limit(1);
    return row ?? null;
  }

  /** Tracking payload for customers/staff; 404 while nothing is dispatched. */
  async trackingForOrder(
    order: Order,
    scope: { userId?: string; storeId?: string },
  ): Promise<PublicDeliveryTracking> {
    if (scope.userId && order.userId !== scope.userId) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order was not found' });
    }
    if (scope.storeId && order.storeId !== scope.storeId) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order was not found' });
    }
    const delivery = await this.syncForOrder(order.id);
    if (!delivery) {
      throw new NotFoundException({
        code: 'DELIVERY_NOT_FOUND',
        message: 'No delivery has been dispatched for this order yet',
      });
    }
    return this.toTracking(order, delivery);
  }

  private toTracking(order: Order, delivery: Delivery): PublicDeliveryTracking {
    const courier = delivery.courier as {
      name?: string;
      phone?: string;
      vehicle?: string | null;
    } | null;
    const etaMinutes =
      (order.deliveryQuote as { estimatedMinutes?: number }).estimatedMinutes ?? null;
    return {
      orderId: order.id,
      externalId: delivery.externalId,
      provider: delivery.provider,
      status: delivery.status,
      courier:
        courier?.name && courier?.phone
          ? { name: courier.name, phone: courier.phone, vehicle: courier.vehicle ?? null }
          : null,
      etaMinutes,
      dispatchedAt: delivery.dispatchedAt.toISOString(),
      deliveredAt: delivery.deliveredAt?.toISOString() ?? null,
      cancelledAt: delivery.cancelledAt?.toISOString() ?? null,
    };
  }

  /** Any non-terminal delivery for the order (cancel eligibility check). */
  async findActiveForOrder(orderId: string): Promise<Delivery | null> {
    const [row] = await this.database.db
      .select()
      .from(deliveries)
      .where(and(eq(deliveries.orderId, orderId), ne(deliveries.status, 'CANCELLED')))
      .limit(1);
    return row ?? null;
  }

  /** Typed integration failures → HTTP-mapped exceptions (never 500s). */
  private providerError(error: unknown): never {
    if (error instanceof DeliveryIntegrationError) {
      if (error.code === 'DELIVERY_PROVIDER_NOT_CONFIGURED') {
        throw new ServiceUnavailableException({ code: error.code, message: error.message });
      }
      throw new ConflictException({ code: error.code, message: error.message });
    }
    throw error;
  }

  /** Wrapped driver errors keep the PG code/constraint on the cause chain. */
  private pgConstraint(error: unknown, constraint: string): boolean {
    let current: unknown = error;
    while (current && typeof current === 'object') {
      const e = current as { code?: string; constraint_name?: string };
      if (e.code === '23505' && e.constraint_name === constraint) return true;
      current = (current as { cause?: unknown }).cause;
    }
    return false;
  }
}
