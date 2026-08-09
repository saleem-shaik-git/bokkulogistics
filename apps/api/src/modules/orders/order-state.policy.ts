import { ConflictException } from '@nestjs/common';
import { ORDER_TERMINAL_STATUSES, type OrderStatus } from '@bokku/shared';

/**
 * OrderStatePolicy — the ONLY legal source of order status transitions
 * (spec: arbitrary transitions are rejected).
 *
 * Actors:
 *  - CUSTOMER: the order's owner (self-service, pre-payment only);
 *  - STAFF:    Bokku operations (store-scoped) — progression + cancellation;
 *  - SYSTEM:   payment confirmations, delivery dispatch events, refunds.
 *
 * Every money-related side effect (reservation release, refunds, delivery
 * settlement) is attached to its transition in OrdersService — the policy
 * says WHETHER a transition is legal; callers perform the effects.
 */
export type OrderActor = 'CUSTOMER' | 'STAFF' | 'SYSTEM';

type Edge = `${OrderStatus}->${OrderStatus}`;

const RULES: Readonly<Record<OrderActor, readonly Edge[]>> = {
  CUSTOMER: ['PENDING_PAYMENT->CANCELLED'],
  STAFF: [
    'PENDING_PAYMENT->CANCELLED',
    'PAID->CONFIRMED',
    'PAID->CANCELLED',
    'CONFIRMED->PREPARING',
    'CONFIRMED->CANCELLED',
    'PREPARING->READY_FOR_PICKUP',
    'PREPARING->CANCELLED',
  ],
  SYSTEM: [
    'PENDING_PAYMENT->PAID',
    'PENDING_PAYMENT->CANCELLED',
    'READY_FOR_PICKUP->DELIVERY_REQUESTED',
    'DELIVERY_REQUESTED->DRIVER_ASSIGNED',
    'DRIVER_ASSIGNED->OUT_FOR_DELIVERY',
    'OUT_FOR_DELIVERY->DELIVERED',
    'CANCELLED->REFUND_PENDING',
    'REFUND_PENDING->REFUNDED',
  ],
};

const LEGAL: ReadonlyMap<OrderActor, ReadonlySet<Edge>> = new Map(
  (Object.keys(RULES) as OrderActor[]).map((actor) => [actor, new Set(RULES[actor])]),
);

export class OrderTransitionError extends ConflictException {
  constructor(
    public readonly from: OrderStatus,
    public readonly to: OrderStatus,
    actor: OrderActor,
  ) {
    super({
      code: 'ORDER_INVALID_TRANSITION',
      message:
        from === to
          ? `Order is already ${from}`
          : `${actor} cannot move an order from ${from} to ${to}`,
    });
    this.name = 'OrderTransitionError';
  }
}

export const OrderStatePolicy = {
  isTerminal(status: OrderStatus): boolean {
    return ORDER_TERMINAL_STATUSES.includes(status);
  },

  actorsFor(from: OrderStatus, to: OrderStatus): OrderActor[] {
    return ([...LEGAL] as Array<[OrderActor, ReadonlySet<Edge>]>)
      .filter(([, edges]) => edges.has(`${from}->${to}`))
      .map(([actor]) => actor);
  },

  isAllowed(actor: OrderActor, from: OrderStatus, to: OrderStatus): boolean {
    return LEGAL.get(actor)?.has(`${from}->${to}`) ?? false;
  },

  /** Throws OrderTransitionError (409 ORDER_INVALID_TRANSITION) when illegal. */
  assertTransition(actor: OrderActor, from: OrderStatus, to: OrderStatus): void {
    if (!this.isAllowed(actor, from, to)) {
      throw new OrderTransitionError(from, to, actor);
    }
  },
} as const;
