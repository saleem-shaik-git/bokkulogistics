import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { orderStatusEnum } from './enums';
import { payments } from './payments';
import { products } from './products';
import { stores } from './stores';
import { users } from './users';

/**
 * Orders. Created by converting a PAID cart (Phase 7):
 *  - **one order per payment** (`orders_payment_unique`) — the payment row
 *    is the durable idempotency anchor (carts come and go, payments don't);
 *  - money columns are integer kobo snapshots recomputed server-side at
 *    payment initialize time and re-validated at conversion;
 *  - `deliveryAddress` + `deliveryQuote` are JSONB snapshots so the order
 *    record is stable against later address/quote edits;
 *  - `cartId` is kept as non-FK provenance (the cart is consumed/deleted at
 *    conversion; enforcing an FK would fight that lifecycle).
 *
 * Status changes only ever happen through OrderStatePolicy + audit logs
 * (`order.*` actions) — direct UPDATEs of `status` are a code smell.
 */
export const orders = pgTable(
  'orders',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Human-friendly reference, e.g. BK-20260810-7K3M2X. */
    orderNumber: text('order_number').notNull(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id),
    /** Provenance only — the payment id is the uniqueness anchor. */
    cartId: uuid('cart_id'),
    status: orderStatusEnum('status').notNull().default('PENDING_PAYMENT'),

    // Money snapshots (integer kobo).
    subtotal: integer('subtotal').notNull(),
    deliveryFee: integer('delivery_fee').notNull(),
    serviceFee: integer('service_fee').notNull(),
    tax: integer('tax').notNull(),
    discount: integer('discount').notNull().default(0),
    total: integer('total').notNull(),
    currency: text('currency').notNull().default('NGN'),

    /** PublicAddress JSONB snapshot at payment time. */
    deliveryAddress: jsonb('delivery_address').notNull(),
    /** Delivery quote JSONB snapshot: quoteId, provider, fee, distanceKm, estimatedMinutes, expiresAt. */
    deliveryQuote: jsonb('delivery_quote').notNull(),
    paymentReference: text('payment_reference'),

    cancelReason: text('cancel_reason'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('orders_number_unique').on(table.orderNumber),
    uniqueIndex('orders_payment_unique').on(table.paymentId),
    index('orders_user_idx').on(table.userId, table.createdAt),
    index('orders_store_status_idx').on(table.storeId, table.status),
    index('orders_status_idx').on(table.status),
  ],
);

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;

/**
 * Order lines. `name`/`sku`/`unitPrice` are SNAPSHOTS taken at payment time
 * (later product edits never rewrite history); `productId` is kept for
 * operations views and inventory bookkeeping.
 */
export const orderItems = pgTable(
  'order_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id),
    name: text('name').notNull(),
    sku: text('sku').notNull(),
    imageUrl: text('image_url'),
    /** Integer kobo, snapshot. */
    unitPrice: integer('unit_price').notNull(),
    quantity: integer('quantity').notNull(),
    /** Integer kobo, snapshot = unitPrice × quantity. */
    lineTotal: integer('line_total').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('order_items_order_idx').on(table.orderId)],
);

export type OrderItem = typeof orderItems.$inferSelect;
export type NewOrderItem = typeof orderItems.$inferInsert;
