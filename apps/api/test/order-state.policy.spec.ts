import { describe, expect, it } from 'vitest';
import { ORDER_STATUSES, type OrderStatus } from '@bokku/shared';

import {
  OrderStatePolicy,
  OrderTransitionError,
  type OrderActor,
} from '../src/modules/orders/order-state.policy';

/**
 * OrderStatePolicy — the complete transition matrix is pinned here
 * (spec: arbitrary transitions are rejected).
 */

const actors: OrderActor[] = ['CUSTOMER', 'STAFF', 'SYSTEM'];

const VALID: Array<[OrderActor, OrderStatus, OrderStatus]> = [
  ['CUSTOMER', 'PENDING_PAYMENT', 'CANCELLED'],
  ['STAFF', 'PENDING_PAYMENT', 'CANCELLED'],
  ['SYSTEM', 'PENDING_PAYMENT', 'CANCELLED'],
  ['SYSTEM', 'PENDING_PAYMENT', 'PAID'],
  ['STAFF', 'PAID', 'CONFIRMED'],
  ['STAFF', 'PAID', 'CANCELLED'],
  ['STAFF', 'CONFIRMED', 'PREPARING'],
  ['STAFF', 'CONFIRMED', 'CANCELLED'],
  ['STAFF', 'PREPARING', 'READY_FOR_PICKUP'],
  ['STAFF', 'PREPARING', 'CANCELLED'],
  ['SYSTEM', 'READY_FOR_PICKUP', 'DELIVERY_REQUESTED'],
  ['SYSTEM', 'DELIVERY_REQUESTED', 'DRIVER_ASSIGNED'],
  ['SYSTEM', 'DRIVER_ASSIGNED', 'OUT_FOR_DELIVERY'],
  ['SYSTEM', 'OUT_FOR_DELIVERY', 'DELIVERED'],
  ['SYSTEM', 'CANCELLED', 'REFUND_PENDING'],
  ['SYSTEM', 'REFUND_PENDING', 'REFUNDED'],
];

const INVALID: Array<[OrderActor, OrderStatus, OrderStatus]> = [
  // Skipping steps
  ['STAFF', 'PAID', 'PREPARING'],
  ['STAFF', 'PAID', 'READY_FOR_PICKUP'],
  ['SYSTEM', 'PAID', 'DELIVERED'],
  ['SYSTEM', 'READY_FOR_PICKUP', 'OUT_FOR_DELIVERY'],
  // Backwards
  ['STAFF', 'CONFIRMED', 'PAID'],
  ['SYSTEM', 'PREPARING', 'PAID'],
  // No-op
  ['CUSTOMER', 'PAID', 'PAID'],
  ['STAFF', 'CONFIRMED', 'CONFIRMED'],
  // Wrong actor
  ['CUSTOMER', 'PENDING_PAYMENT', 'PAID'],
  ['STAFF', 'PENDING_PAYMENT', 'PAID'],
  ['CUSTOMER', 'PAID', 'CONFIRMED'],
  ['CUSTOMER', 'OUT_FOR_DELIVERY', 'DELIVERED'],
  ['STAFF', 'DELIVERY_REQUESTED', 'DRIVER_ASSIGNED'],
  ['STAFF', 'OUT_FOR_DELIVERY', 'DELIVERED'],
  // Refund statuses cannot be set directly by people
  ['STAFF', 'CANCELLED', 'REFUND_PENDING'],
  ['STAFF', 'REFUND_PENDING', 'REFUNDED'],
  ['CUSTOMER', 'REFUND_PENDING', 'REFUNDED'],
  // Out of terminal states (comprehensive check below too)
  ['STAFF', 'DELIVERED', 'CANCELLED'],
  ['SYSTEM', 'CANCELLED', 'PAID'],
  ['SYSTEM', 'REFUNDED', 'CANCELLED'],
];

describe('OrderStatePolicy — valid edges', () => {
  it.each(VALID)('%s may move %s → %s', (actor, from, to) => {
    expect(OrderStatePolicy.isAllowed(actor, from, to)).toBe(true);
    expect(() => OrderStatePolicy.assertTransition(actor, from, to)).not.toThrow();
  });
});

describe('OrderStatePolicy — invalid edges', () => {
  it.each(INVALID)('%s may NOT move %s → %s', (actor, from, to) => {
    expect(OrderStatePolicy.isAllowed(actor, from, to)).toBe(false);
    expect(() => OrderStatePolicy.assertTransition(actor, from, to)).toThrowError(
      OrderTransitionError,
    );
    try {
      OrderStatePolicy.assertTransition(actor, from, to);
    } catch (error) {
      const body = (error as OrderTransitionError).getResponse() as { code: string };
      expect(body.code).toBe('ORDER_INVALID_TRANSITION');
    }
  });
});

describe('OrderStatePolicy — invariants', () => {
  it('no transitions out of terminal states, for anyone, to anything', () => {
    for (const from of ['DELIVERED', 'CANCELLED', 'REFUNDED'] as OrderStatus[]) {
      for (const to of ORDER_STATUSES) {
        for (const actor of actors) {
          if (from === 'CANCELLED' && to === 'REFUND_PENDING') continue;
          expect(OrderStatePolicy.isAllowed(actor, from, to)).toBe(false);
        }
      }
    }
  });

  it('actorsFor reports exactly the allowed actors', () => {
    expect(OrderStatePolicy.actorsFor('PAID', 'CONFIRMED')).toEqual(['STAFF']);
    expect(OrderStatePolicy.actorsFor('PENDING_PAYMENT', 'CANCELLED')).toEqual([
      'CUSTOMER',
      'STAFF',
      'SYSTEM',
    ]);
    expect(OrderStatePolicy.actorsFor('PAID', 'DELIVERED')).toEqual([]);
  });

  it('error messages read clearly', () => {
    try {
      OrderStatePolicy.assertTransition('STAFF', 'PAID', 'PAID');
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toContain('already PAID');
    }
  });
});
