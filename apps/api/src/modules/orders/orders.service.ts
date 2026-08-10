import { randomInt } from 'node:crypto';

import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, count, desc, eq, sql, type SQL } from 'drizzle-orm';
import {
  auditLogs,
  carts,
  orderItems,
  orders,
  payments,
  type DatabaseConnection,
  type Order,
  type OrderItem,
  type Payment,
  type User,
} from '@bokku/database';
import type { EnvConfig } from '@bokku/config';
import {
  ORDER_STATUSES,
  type OrderDeliveryQuote,
  type OrderStatus,
  type Paginated,
  type PublicAddress,
  type PublicOrderDetail,
  type PublicOrderItem,
  type PublicOrderSummary,
} from '@bokku/shared';

import { DRIZZLE_CLIENT, ENV_CONFIG } from '../../config/constants';
import {
  buildPaginationMeta,
  parsePagination,
  type PaginationQuery,
} from '../../common/pagination';
import { AuditService } from '../audit/audit.module';
import { InventoryService, type DbTransaction } from '../inventory/inventory.service';
import { OrderStatePolicy } from './order-state.policy';
import type { PaymentMetadata } from '../payments/payments.service';

const ORDER_NUMBER_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateOrderNumber(): string {
  const day = new Date().toISOString().slice(0, 10).replaceAll('-', '');
  let suffix = '';
  for (let i = 0; i < 6; i += 1) {
    suffix += ORDER_NUMBER_ALPHABET[randomInt(ORDER_NUMBER_ALPHABET.length)];
  }
  return `BK-${day}-${suffix}`;
}

/**
 * Orders. An order is born when a payment settles:
 *  - automatically, right inside confirmFromProvider() (payment.confirm);
 *  - or via POST /orders from the customer (http) — both flow through the
 *    SAME idempotent conversion (one order per payment, enforced by
 *    `orders_payment_unique`, so retries/double-clicks converge).
 * Conversion reserves stock atomically; failures roll back the whole
 * conversion and are audited (`order.conversion_failed`), never partial.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @Inject(DRIZZLE_CLIENT) private readonly database: DatabaseConnection,
    @Inject(ENV_CONFIG) private readonly env: EnvConfig,
    private readonly inventory: InventoryService,
    private readonly audit: AuditService,
  ) {}

  // ── Conversion (payment → order) ────────────────────────────────

  async createFromPayment(
    payment: Payment,
    trigger: 'payment.confirm' | 'http',
  ): Promise<{ order: Order; created: boolean }> {
    if (payment.status !== 'SUCCESS') {
      throw new ConflictException({
        code: 'PAYMENT_NOT_SETTLED',
        message: 'The payment has not been confirmed as successful yet',
      });
    }
    const existing = await this.findByPaymentId(payment.id);
    if (existing) return { order: existing, created: false };

    const meta = payment.metadata as unknown as PaymentMetadata;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const order = await this.database.db.transaction(async (tx) => {
          // Reserve stock first — a failure rolls back and leaves no order.
          await this.inventory.reserve(
            meta.lines.map((line) => ({ productId: line.productId, quantity: line.quantity })),
            meta.storeId,
            tx,
          );

          const orderNumber = await this.nextAvailableOrderNumber(tx);
          const [created] = await tx
            .insert(orders)
            .values({
              orderNumber,
              userId: payment.userId,
              storeId: meta.storeId,
              paymentId: payment.id,
              cartId: meta.cartId,
              status: 'PENDING_PAYMENT',
              subtotal: meta.breakdown['subtotal'] ?? 0,
              deliveryFee: meta.breakdown['deliveryFee'] ?? 0,
              serviceFee: meta.breakdown['serviceFee'] ?? 0,
              tax: meta.breakdown['tax'] ?? 0,
              discount: meta.breakdown['discount'] ?? 0,
              total: meta.breakdown['total'] ?? payment.amount,
              currency: payment.currency,
              deliveryAddress: meta.addressSnapshot,
              deliveryQuote: meta.quote,
              paymentReference: payment.reference,
            })
            .returning();
          const order = created ?? raise(new InternalServerErrorException('Order insert failed'));

          await tx.insert(orderItems).values(
            meta.lines.map((line) => ({
              orderId: order.id,
              productId: line.productId,
              name: line.name,
              sku: line.sku,
              imageUrl: line.imageUrl,
              unitPrice: line.unitPrice,
              quantity: line.quantity,
              lineTotal: line.lineTotal,
            })),
          );

          // The order was pending payment; the payment just settled.
          const [paid] = await tx
            .update(orders)
            .set({ status: 'PAID', paidAt: payment.paidAt ?? new Date(), updatedAt: new Date() })
            .where(eq(orders.id, order.id))
            .returning();

          // Consume the cart (items cascade).
          await tx.delete(carts).where(eq(carts.id, meta.cartId));

          await this.auditInTx(tx, {
            actorUserId: payment.userId,
            action: 'order.created',
            entityType: 'order',
            entityId: order.id,
            metadata: {
              orderNumber,
              total: order.total,
              paymentReference: payment.reference,
              trigger,
            },
          });
          await this.auditInTx(tx, {
            action: 'order.status_changed',
            entityType: 'order',
            entityId: order.id,
            metadata: { from: 'PENDING_PAYMENT', to: 'PAID', actor: 'SYSTEM' },
          });
          return paid ?? order;
        });
        return { order, created: true };
      } catch (error) {
        if (this.pgConstraint(error, 'orders_number_unique') && attempt < 2) continue;
        if (this.pgConstraint(error, 'orders_payment_unique')) {
          // Concurrent conversion — the winner's order is the correct one.
          const winner = await this.findByPaymentId(payment.id);
          if (winner) return { order: winner, created: false };
        }
        if (error instanceof ConflictException) {
          await this.audit.record({
            action: 'order.conversion_failed',
            entityType: 'payment',
            entityId: payment.id,
            metadata: {
              paymentReference: payment.reference,
              trigger,
              reason: (error.getResponse() as { message?: string }).message ?? 'conflict',
            },
          });
        }
        throw error;
      }
    }
    throw new InternalServerErrorException('Could not allocate an order number');
  }

  // ── Customer surface ────────────────────────────────────────────

  async listMine(userId: string, query: PaginationQuery): Promise<Paginated<PublicOrderSummary>> {
    const { page, limit, offset } = parsePagination(query);
    const where = eq(orders.userId, userId);
    const [rows, countRows] = await Promise.all([
      this.database.db
        .select({ order: orders, itemCount: ITEM_COUNT_SQL })
        .from(orders)
        .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
        .where(where)
        .groupBy(orders.id)
        .orderBy(desc(orders.createdAt))
        .limit(limit)
        .offset(offset),
      this.database.db.select({ total: count() }).from(orders).where(where),
    ]);
    const total = countRows[0]?.total ?? 0;
    return {
      data: rows.map((row) => this.toSummary(row.order, row.itemCount)),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async getMine(userId: string, orderId: string): Promise<PublicOrderDetail> {
    const order = await this.requireOrder(and(eq(orders.id, orderId), eq(orders.userId, userId)));
    return this.toDetail(order);
  }

  /**
   * Customer self-service cancellation — only legal while PENDING_PAYMENT
   * (policy). Paid orders (all orders in the current pay-first flow) can be
   * cancelled only by Bokku staff, who also run the refund path.
   */
  async cancelMine(userId: string, orderId: string, actor: User): Promise<PublicOrderDetail> {
    const order = await this.requireOrder(and(eq(orders.id, orderId), eq(orders.userId, userId)));
    OrderStatePolicy.assertTransition('CUSTOMER', order.status, 'CANCELLED');

    const updated = await this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .update(orders)
        .set({ status: 'CANCELLED', cancelledAt: new Date(), updatedAt: new Date() })
        .where(eq(orders.id, order.id))
        .returning();
      await this.auditInTx(tx, {
        actorUserId: actor.id,
        action: 'order.cancelled',
        entityType: 'order',
        entityId: order.id,
        metadata: { by: 'CUSTOMER', from: order.status },
      });
      return row ?? order;
    });
    return this.toDetail(updated);
  }

  // ── Bokku operations surface ────────────────────────────────────

  async listForStore(
    storeId: string,
    query: PaginationQuery & { status?: string },
  ): Promise<Paginated<PublicOrderSummary>> {
    const { page, limit, offset } = parsePagination(query);
    const filters: SQL[] = [eq(orders.storeId, storeId)];
    if (query.status && ORDER_STATUSES.includes(query.status as OrderStatus)) {
      filters.push(eq(orders.status, query.status as OrderStatus));
    }
    const where = and(...filters);
    const [rows, countRows] = await Promise.all([
      this.database.db
        .select({ order: orders, itemCount: ITEM_COUNT_SQL })
        .from(orders)
        .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
        .where(where)
        .groupBy(orders.id)
        .orderBy(desc(orders.createdAt))
        .limit(limit)
        .offset(offset),
      this.database.db.select({ total: count() }).from(orders).where(where),
    ]);
    const total = countRows[0]?.total ?? 0;
    return {
      data: rows.map((row) => this.toSummary(row.order, row.itemCount)),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async getForStore(storeId: string, orderId: string): Promise<PublicOrderDetail> {
    const order = await this.requireOrder(and(eq(orders.id, orderId), eq(orders.storeId, storeId)));
    return this.toDetail(order);
  }

  // ── Platform admin surface (Phase 10): read-only, cross-store ──

  async listAll(
    query: PaginationQuery & { status?: string; storeId?: string },
  ): Promise<Paginated<PublicOrderSummary>> {
    const { page, limit, offset } = parsePagination(query);
    const filters: SQL[] = [];
    if (query.storeId) filters.push(eq(orders.storeId, query.storeId));
    if (query.status && ORDER_STATUSES.includes(query.status as OrderStatus)) {
      filters.push(eq(orders.status, query.status as OrderStatus));
    }
    const where = filters.length > 0 ? and(...filters) : undefined;
    const [rows, countRows] = await Promise.all([
      this.database.db
        .select({ order: orders, itemCount: ITEM_COUNT_SQL })
        .from(orders)
        .leftJoin(orderItems, eq(orderItems.orderId, orders.id))
        .where(where)
        .groupBy(orders.id)
        .orderBy(desc(orders.createdAt))
        .limit(limit)
        .offset(offset),
      this.database.db.select({ total: count() }).from(orders).where(where),
    ]);
    const total = countRows[0]?.total ?? 0;
    return {
      data: rows.map((row) => this.toSummary(row.order, row.itemCount)),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  /** Read any order regardless of store (admin oversight — read-only). */
  async getAny(orderId: string): Promise<PublicOrderDetail> {
    return this.toDetail(await this.requireOrder(eq(orders.id, orderId)));
  }

  /** The raw row (bokku orchestration needs paymentId for refunds). */
  async getRowById(orderId: string): Promise<Order> {
    return this.requireOrder(eq(orders.id, orderId));
  }

  /** Staff transitions (policy-checked) with reservation side effects. */
  async transitionForStore(
    storeId: string,
    orderId: string,
    to: OrderStatus,
    reason: string | undefined,
    actor: User,
  ): Promise<PublicOrderDetail> {
    const order = await this.requireOrder(and(eq(orders.id, orderId), eq(orders.storeId, storeId)));
    OrderStatePolicy.assertTransition('STAFF', order.status, to);

    const updated = await this.database.db.transaction(async (tx) => {
      if (to === 'CANCELLED') {
        const lines = await tx
          .select({ productId: orderItems.productId, quantity: orderItems.quantity })
          .from(orderItems)
          .where(eq(orderItems.orderId, order.id));
        await this.inventory.releaseReservation(lines, storeId, tx);
      }

      const [row] = await tx
        .update(orders)
        .set({
          status: to,
          updatedAt: new Date(),
          ...(to === 'CANCELLED' ? { cancelledAt: new Date(), cancelReason: reason ?? null } : {}),
        })
        .where(eq(orders.id, order.id))
        .returning();

      await this.auditInTx(tx, {
        actorUserId: actor.id,
        action: to === 'CANCELLED' ? 'order.cancelled' : 'order.status_changed',
        entityType: 'order',
        entityId: order.id,
        metadata: { from: order.status, to, actor: 'STAFF', ...(reason ? { reason } : {}) },
      });
      return row ?? order;
    });
    return this.toDetail(updated);
  }

  /** SYSTEM transitions (refund flow now; delivery dispatch in Phase 9). */
  async transitionSystem(
    orderId: string,
    to: OrderStatus,
    metadata: Record<string, unknown> = {},
  ): Promise<PublicOrderDetail> {
    const order = await this.requireOrder(eq(orders.id, orderId));
    OrderStatePolicy.assertTransition('SYSTEM', order.status, to);

    const [updated] = await this.database.db
      .update(orders)
      .set({
        status: to,
        updatedAt: new Date(),
        ...(to === 'DELIVERED' ? { deliveredAt: new Date() } : {}),
      })
      .where(eq(orders.id, order.id))
      .returning();
    await this.audit.record({
      action: 'order.status_changed',
      entityType: 'order',
      entityId: order.id,
      metadata: { from: order.status, to, actor: 'SYSTEM', ...metadata },
    });
    return this.toDetail(updated ?? order);
  }

  /**
   * DELIVERED with effects: the stock reservation is settled (on-hand and
   * reserved both drop) in the same transaction as the status change and
   * its audit row — the money-side bookkeeping can never drift from the
   * order state.
   */
  async completeDelivery(orderId: string): Promise<PublicOrderDetail> {
    const order = await this.requireOrder(eq(orders.id, orderId));
    OrderStatePolicy.assertTransition('SYSTEM', order.status, 'DELIVERED');

    const updated = await this.database.db.transaction(async (tx) => {
      const lines = await tx
        .select({ productId: orderItems.productId, quantity: orderItems.quantity })
        .from(orderItems)
        .where(eq(orderItems.orderId, order.id));
      await this.inventory.settleReservation(lines, order.storeId, tx);

      const [row] = await tx
        .update(orders)
        .set({ status: 'DELIVERED', deliveredAt: new Date(), updatedAt: new Date() })
        .where(eq(orders.id, order.id))
        .returning();
      await this.auditInTx(tx, {
        action: 'order.status_changed',
        entityType: 'order',
        entityId: order.id,
        metadata: { from: order.status, to: 'DELIVERED', actor: 'SYSTEM' },
      });
      return row ?? order;
    });
    return this.toDetail(updated);
  }

  // ── Lookups & mapping ───────────────────────────────────────────

  async findByPaymentId(paymentId: string): Promise<Order | null> {
    const [row] = await this.database.db
      .select()
      .from(orders)
      .where(eq(orders.paymentId, paymentId))
      .limit(1);
    return row ?? null;
  }

  /** Settled payment row for order placement (404 for other users' refs). */
  async findSettledPaymentForUser(userId: string, reference: string): Promise<Payment> {
    const [payment] = await this.database.db
      .select()
      .from(payments)
      .where(and(eq(payments.reference, reference), eq(payments.userId, userId)))
      .limit(1);
    if (!payment) {
      throw new NotFoundException({ code: 'PAYMENT_NOT_FOUND', message: 'Payment was not found' });
    }
    return payment;
  }

  private async requireOrder(where: SQL | undefined): Promise<Order> {
    const [row] = await this.database.db.select().from(orders).where(where).limit(1);
    if (!row) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: 'Order was not found' });
    }
    return row;
  }

  private async nextAvailableOrderNumber(tx: DbTransaction): Promise<string> {
    for (let i = 0; i < 5; i += 1) {
      const candidate = generateOrderNumber();
      const [dupe] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(eq(orders.orderNumber, candidate))
        .limit(1);
      if (!dupe) return candidate;
    }
    throw new InternalServerErrorException('Could not allocate an order number');
  }

  /** Transaction-bound audit insert (rolls back with the order it describes). */
  private async auditInTx(
    tx: DbTransaction,
    entry: Omit<typeof auditLogs.$inferInsert, 'id' | 'createdAt'>,
  ): Promise<void> {
    await tx.insert(auditLogs).values(entry);
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

  private toSummary(order: Order, itemCount: number): PublicOrderSummary {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      total: order.total,
      currency: order.currency,
      itemCount,
      createdAt: order.createdAt.toISOString(),
      paidAt: order.paidAt?.toISOString() ?? null,
    };
  }

  private async toDetail(order: Order): Promise<PublicOrderDetail> {
    const items = await this.database.db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));
    const lines: PublicOrderItem[] = items.map((item: OrderItem) => ({
      id: item.id,
      productId: item.productId,
      name: item.name,
      sku: item.sku,
      imageUrl: item.imageUrl,
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
    }));
    return {
      ...this.toSummary(
        order,
        lines.reduce((sum, line) => sum + line.quantity, 0),
      ),
      items: lines,
      deliveryAddress: order.deliveryAddress as unknown as PublicAddress,
      deliveryQuote: order.deliveryQuote as unknown as OrderDeliveryQuote,
      subtotal: order.subtotal,
      deliveryFee: order.deliveryFee,
      serviceFee: order.serviceFee,
      tax: order.tax,
      discount: order.discount,
      paymentReference: order.paymentReference,
      cancelReason: order.cancelReason,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      updatedAt: order.updatedAt.toISOString(),
    };
  }
}

/** Items per order — used with a LEFT JOIN (a correlated subquery would bind
 *  the outer reference to the inner scope and silently count nothing). */
const ITEM_COUNT_SQL = sql<number>`coalesce(sum(${orderItems.quantity}), 0)`.mapWith(Number);

function raise(error: Error): never {
  throw error;
}
