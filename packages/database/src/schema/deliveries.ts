import { index, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { deliveryProviderEnum, deliveryStatusEnum } from './enums';
import { orders } from './orders';

/**
 * One delivery per order (partial failure → unique constraint converges).
 * Born when dispatch happens at order READY_FOR_PICKUP: provider
 * identifiers, courier (assigned mid-flight), address snapshots and the
 * last provider-reported status. The order's own order_status column stays
 * the customer-facing truth; this table is the provider-side record.
 */
export const deliveries = pgTable(
  'deliveries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    orderId: uuid('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    provider: deliveryProviderEnum('provider').notNull(),
    externalId: text('external_id').notNull(),
    status: deliveryStatusEnum('status').notNull().default('REQUESTED'),
    quoteId: text('quote_id'),
    /** { name, phone, vehicle } — surfaced to customers once assigned. */
    courier: jsonb('courier'),
    /** DeliveryPoint { address, latitude, longitude } snapshots. */
    pickup: jsonb('pickup').notNull(),
    dropoff: jsonb('dropoff').notNull(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }).notNull().defaultNow(),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true }),
    cancelReason: text('cancel_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('deliveries_order_unique').on(table.orderId),
    index('deliveries_status_idx').on(table.status),
  ],
);

export type Delivery = typeof deliveries.$inferSelect;
export type NewDelivery = typeof deliveries.$inferInsert;
