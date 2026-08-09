import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { products } from './products';
import { stores } from './stores';
import { users } from './users';

/**
 * One active cart per authenticated user (MVP).
 *
 * The cart is LOCKED to a single store (single-store cart rule): adding a
 * product from another store is rejected with CART_STORE_CONFLICT — the
 * client must clear the cart explicitly first.
 *
 * No prices are stored on carts or cart items. Every cart read joins the
 * current product rows, so prices are only ever taken from the database
 * (business rule: the client never tells us what something costs). The
 * price snapshot for an order is taken at checkout (Phase 5+), not here.
 */
export const carts = pgTable(
  'carts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('carts_user_unique').on(table.userId),
    index('carts_store_idx').on(table.storeId),
  ],
);

export type Cart = typeof carts.$inferSelect;
export type NewCart = typeof carts.$inferInsert;

/**
 * One line per (cart, product): re-adding a product merges quantities
 * atomically via an upsert, never a duplicate row. `quantity > 0` is
 * enforced by a CHECK so a line can never represent nothing.
 *
 * Stock is intentionally NOT reserved while items sit in the cart —
 * validation against sellable stock here is a UX guard; the hard
 * never-negative invariant is enforced by inventory reservations at
 * checkout (Phase 7) via conditional atomic UPDATEs.
 */
export const cartItems = pgTable(
  'cart_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cartId: uuid('cart_id')
      .notNull()
      .references(() => carts.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    quantity: integer('quantity').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('cart_items_cart_product_unique').on(table.cartId, table.productId),
    index('cart_items_product_idx').on(table.productId),
    check('cart_items_quantity_positive', sql`${table.quantity} > 0`),
  ],
);

export type CartItem = typeof cartItems.$inferSelect;
export type NewCartItem = typeof cartItems.$inferInsert;
