import { sql } from 'drizzle-orm';
import { check, index, integer, pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { products } from './products';
import { stores } from './stores';

/**
 * Stock authority per (store, product).
 *
 * quantityOnHand: physical units at the store.
 * reservedQuantity: units reserved by orders not yet fulfilled (Phase 7).
 * sellable = quantityOnHand - reservedQuantity.
 *
 * Race safety: all adjustments go through conditional atomic UPDATEs
 * (`... WHERE quantity_on_hand + delta >= 0`) — the database is the guard;
 * stock can never go negative even under concurrent checkouts.
 */
export const inventory = pgTable(
  'inventory',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    quantityOnHand: integer('quantity_on_hand').notNull().default(0),
    reservedQuantity: integer('reserved_quantity').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('inventory_store_product_unique').on(table.storeId, table.productId),
    index('inventory_product_idx').on(table.productId),
    check('inventory_on_hand_non_negative', sql`${table.quantityOnHand} >= 0`),
    check('inventory_reserved_non_negative', sql`${table.reservedQuantity} >= 0`),
  ],
);

export type Inventory = typeof inventory.$inferSelect;
export type NewInventory = typeof inventory.$inferInsert;
