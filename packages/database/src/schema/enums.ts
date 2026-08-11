import { pgEnum } from 'drizzle-orm/pg-core';

export const userRoleEnum = pgEnum('user_role', [
  'CUSTOMER',
  'STORE_MANAGER',
  'BOKKU_ADMIN',
  'PLATFORM_ADMIN',
]);

export const userStatusEnum = pgEnum('user_status', ['ACTIVE', 'INACTIVE', 'SUSPENDED']);

export const storeStatusEnum = pgEnum('store_status', ['ACTIVE', 'INACTIVE', 'SUSPENDED']);

export const productStatusEnum = pgEnum('product_status', [
  'ACTIVE',
  'INACTIVE',
  'OUT_OF_STOCK',
  'DRAFT',
]);

export const paymentProviderEnum = pgEnum('payment_provider', ['MOCK', 'PAYSTACK']);

export const paymentStatusEnum = pgEnum('payment_status', [
  'PENDING',
  'SUCCESS',
  'FAILED',
  'ABANDONED',
  'REFUNDED',
]);

export const deliveryProviderEnum = pgEnum('delivery_provider', ['MOCK', 'UBER', 'BOLT']);

/**
 * Courier lifecycle (spec): QUOTE exists only in-memory/cache — a row is
 * born at REQUESTED (dispatch from READY_FOR_PICKUP).
 */
export const deliveryStatusEnum = pgEnum('delivery_status', [
  'REQUESTED',
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVING',
  'PICKED_UP',
  'IN_TRANSIT',
  'DELIVERED',
  'CANCELLED',
]);

/**
 * The order state machine (spec): transitions are validated by
 * apps/api src/modules/orders/order-state.policy.ts — never set statuses
 * without going through the policy.
 */
export const orderStatusEnum = pgEnum('order_status', [
  'PENDING_PAYMENT',
  'PAID',
  'CONFIRMED',
  'PREPARING',
  'READY_FOR_PICKUP',
  'DELIVERY_REQUESTED',
  'DRIVER_ASSIGNED',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
  'CANCELLED',
  'REFUND_PENDING',
  'REFUNDED',
]);
