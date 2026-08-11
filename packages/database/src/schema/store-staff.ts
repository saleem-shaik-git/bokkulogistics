import { pgTable, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { stores } from './stores';
import { users } from './users';

/**
 * Membership link between operational staff (STORE_MANAGER / BOKKU_ADMIN)
 * and the stores they may manage. The StoreStaffGuard enforces this:
 * changing a store id in a URL never grants access to another store
 * (resource-level authorization, business rule 9). PLATFORM_ADMIN bypasses.
 */
export const storeStaff = pgTable(
  'store_staff',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    storeId: uuid('store_id')
      .notNull()
      .references(() => stores.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('store_staff_store_user_unique').on(table.storeId, table.userId)],
);

export type StoreStaff = typeof storeStaff.$inferSelect;
export type NewStoreStaff = typeof storeStaff.$inferInsert;
