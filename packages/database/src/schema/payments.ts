import { sql } from 'drizzle-orm';
import { check, index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { addresses } from './addresses';
import { carts } from './carts';
import { paymentProviderEnum, paymentStatusEnum } from './enums';
import { stores } from './stores';
import { users } from './users';

export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
    cartId: uuid('cart_id').references(() => carts.id, { onDelete: 'set null' }),
    addressId: uuid('address_id').references(() => addresses.id, { onDelete: 'set null' }),
    storeId: uuid('store_id').notNull().references(() => stores.id, { onDelete: 'cascade' }),
    reference: text('reference').notNull(),
    provider: paymentProviderEnum('provider').notNull(),
    status: paymentStatusEnum('status').notNull().default('PENDING'),
    amount: integer('amount').notNull(),
    currency: text('currency').notNull().default('NGN'),
    email: text('email').notNull(),
    authorizationUrl: text('authorization_url'),
    providerReference: text('provider_reference'),
    channel: text('channel'),
    metadata: jsonb('metadata'),
    failureReason: text('failure_reason'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('payments_reference_unique').on(table.reference),
    uniqueIndex('payments_one_pending_per_cart').on(table.cartId).where(sql`${table.status} = 'PENDING'`),
    index('payments_user_idx').on(table.userId),
    index('payments_status_idx').on(table.status),
    index('payments_provider_ref_idx').on(table.providerReference),
    check('payments_amount_non_negative', sql`${table.amount} >= 0`),
  ],
);

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
