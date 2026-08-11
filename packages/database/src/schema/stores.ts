import {
  index,
  numeric,
  pgTable,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { storeStatusEnum } from './enums';

/**
 * Merchant stores. The MVP ships with a single store (code "BOKKU") but the
 * model supports multiple stores/merchants without schema changes.
 */
export const stores = pgTable(
  'stores',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    name: text('name').notNull(),
    /** Short upper-case business code, e.g. "BOKKU". */
    code: text('code').notNull(),
    description: text('description'),
    address: text('address').notNull(),
    city: text('city').notNull(),
    state: text('state').notNull(),
    latitude: numeric('latitude', { precision: 10, scale: 7 }),
    longitude: numeric('longitude', { precision: 10, scale: 7 }),
    phone: text('phone'),
    status: storeStatusEnum('status').notNull().default('ACTIVE'),
    openingTime: time('opening_time'),
    closingTime: time('closing_time'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('stores_code_unique').on(table.code),
    index('stores_status_idx').on(table.status),
    index('stores_city_idx').on(table.city),
  ],
);

export type Store = typeof stores.$inferSelect;
export type NewStore = typeof stores.$inferInsert;
