import { sql } from 'drizzle-orm';
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

import { addresses } from './addresses';
import { carts } from './carts';
import { paymentProviderEnum, paymentStatusEnum } from './enums';
import { stores } from './stores';
import { users } from './users';

/**
 * Payment attempts, one row per provider transaction.
 *
 * Idempotency rules (spec):
 *  - `reference` is OUR canonical idempotency key (unique) — never a
 *    provider-generated value — so a retry of /payments/initialize can
 *    safely return the same transaction;
 *  - at most ONE pending payment per cart (partial unique index): if the
 *    cart total changed, the old pending row is ABANDONED and a fresh one
 *    is created in the same transaction;
 *  - webhooks are applied idempotently — a duplicate delivery leaves a
 *    SUCCESS payment untouched (see PaymentsService.confirmFromProvider).
 *
 * The `amount` (integer kobo) is snapped from the server-computed checkout
 * breakdown at initialize time and stored in `metadata.breakdown` for the
 * Phase 7 order. Provider-verified amounts MUST match `amount` — any
 * mismatch fails the payment instead of trusting the provider.
 *
 * FKs to carts/addresses use SET NULL: Phase 7 consumes the cart into an
 * order and clears it, while the payment record must survive for audit.
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    cartId: uuid('cart_id').references(() => carts.id, { onDelete: 'set null' }),
    addressId: uuid('address_id').references(() => addresses.id, { onDelete: 'set null' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    /** Our reference (bokku_pay_<32hex>) — the idempotency key. */
    reference: text('reference').notNull(),
    provider: paymentProviderEnum('provider').notNull(),
    status: paymentStatusEnum('status').notNull().default('PENDING'),
    /** Integer kobo, server-computed at initialize time. */
    amount: integer('amount').notNull(),
    currency: text('currency').notNull().default('NGN'),
    /** Payer email snapshot for the provider. */
    email: text('email').notNull(),
    /** Hosted checkout URL returned at initialize (for idempotent retries). */
    authorizationUrl: text('authorization_url'),
    /** Provider-side id / access code when known. */
    providerReference: text('provider_reference'),
    /** card / bank / ussd / mock — from provider verification. */
    channel: text('channel'),
    /** Breakdown + cart/address/quote snapshot used in Phase 7 order creation. */
    metadata: jsonb('metadata'),
    failureReason: text('failure_reason'),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('payments_reference_unique').on(table.reference),
    uniqueIndex('payments_one_pending_per_cart')
      .on(table.cartId)
      .where(sql`${table.status} = 'PENDING'`),
    index('payments_user_idx').on(table.userId),
    index('payments_status_idx').on(table.status),
    index('payments_provider_ref_idx').on(table.providerReference),
  ],
);

export type Payment = typeof payments.$inferSelect;
export type NewPayment = typeof payments.$inferInsert;
