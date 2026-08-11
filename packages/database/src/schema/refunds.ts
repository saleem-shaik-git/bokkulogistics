import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { payments } from './payments';

export const refunds = pgTable(
  'refunds',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    paymentId: uuid('payment_id')
      .notNull()
      .references(() => payments.id, { onDelete: 'cascade' }),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull().default('NGN'),
    status: text('status').notNull().default('REQUESTED'),
    providerReference: text('provider_reference'),
    providerStatus: text('provider_status'),
    failureReason: text('failure_reason'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp('processed_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('refunds_payment_unique').on(table.paymentId),
    uniqueIndex('refunds_provider_reference_unique').on(table.providerReference),
    index('refunds_status_idx').on(table.status),
    check(
      'refunds_status_valid',
      sql`${table.status} IN ('REQUESTED', 'PENDING', 'PROCESSING', 'NEEDS_ATTENTION', 'PROCESSED', 'FAILED')`,
    ),
    check('refunds_amount_positive', sql`${table.amount} > 0`),
  ],
);

export type Refund = typeof refunds.$inferSelect;
export type NewRefund = typeof refunds.$inferInsert;
