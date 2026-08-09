import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * Customer delivery addresses (owner-scoped, never shared between users).
 *
 * Coordinates are optional: the web form skips them for now (map picking
 * arrives with MapsService in Phase 9); the mock delivery provider falls
 * back to a flat default distance when either endpoint lacks coordinates.
 *
 * `isDefault` is protected by a partial unique index — at most ONE default
 * address per user, enforced by the database even under concurrent writes.
 * The service flips flags transactionally on top of this guarantee.
 */
export const addresses = pgTable(
  'addresses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Short nickname, e.g. "Home" / "Office". */
    label: text('label'),
    street: text('street').notNull(),
    city: text('city').notNull(),
    state: text('state').notNull(),
    /** Optional nearby landmark to help the courier. */
    landmark: text('landmark'),
    latitude: numeric('latitude', { precision: 10, scale: 7 }),
    longitude: numeric('longitude', { precision: 10, scale: 7 }),
    isDefault: boolean('is_default').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('addresses_user_idx').on(table.userId),
    uniqueIndex('addresses_one_default_per_user')
      .on(table.userId)
      .where(sql`${table.isDefault}`),
  ],
);

export type Address = typeof addresses.$inferSelect;
export type NewAddress = typeof addresses.$inferInsert;
