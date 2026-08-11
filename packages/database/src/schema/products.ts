import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { categories } from './categories';
import { productStatusEnum } from './enums';
import { stores } from './stores';

/**
 * Products sold by a store.
 *
 * `price` is ALWAYS an integer in minor currency units (kobo) — never a
 * float. Display formatting is a presentation concern (₦ = price / 100).
 *
 * Stock is NOT stored here: the `inventory` table is the stock authority
 * (per store+product), which keeps order-time locking in one place.
 * Product responses expose stock via joins (`stockQuantity`).
 */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    slug: text('slug').notNull(),
    description: text('description'),
    /** Stock-keeping unit — unique per store. */
    sku: text('sku').notNull(),
    /** Integer minor units (kobo). */
    price: integer('price').notNull(),
    /** Low-water mark for reorder alerts (managed with inventory). */
    lowStockThreshold: integer('low_stock_threshold').notNull().default(5),
    /** Cover image; gallery images live in product_images. */
    imageUrl: text('image_url'),
    status: productStatusEnum('status').notNull().default('DRAFT'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (table) => [
    uniqueIndex('products_store_slug_unique').on(table.storeId, table.slug),
    uniqueIndex('products_store_sku_unique').on(table.storeId, table.sku),
    index('products_store_status_idx').on(table.storeId, table.status),
    index('products_category_idx').on(table.categoryId),
    index('products_name_idx').on(table.name),
  ],
);

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;

/** Gallery images for a product (cover lives on products.image_url). */
export const productImages = pgTable(
  'product_images',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    productId: uuid('product_id')
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    altText: text('alt_text'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('product_images_product_idx').on(table.productId)],
);

export type ProductImage = typeof productImages.$inferSelect;
export type NewProductImage = typeof productImages.$inferInsert;
