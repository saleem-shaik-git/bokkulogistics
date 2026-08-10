import { index, jsonb, pgTable, text, timestamp, boolean, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/**
 * In-app notification feed (Phase 11). One row per recipient+event —
 * polling-first: the web app polls the unread count and feed; there are
 * no websockets. `data` carries deep-link/target metadata (orderId,
 * orderNumber, courier, status, …) without decrypting the render text.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Dotted machine type, e.g. "order.paid", "delivery.delivered". */
    type: text('type').notNull(),
    title: text('title').notNull(),
    body: text('body').notNull(),
    /** Target/payload metadata for deep links (snake/JSON keys). */
    data: jsonb('data'),
    readAt: timestamp('read_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notifications_user_created_idx').on(table.userId, table.createdAt),
    index('notifications_user_unread_idx').on(table.userId, table.readAt),
  ],
);

/**
 * Per-user notification preferences — lazily created with all defaults
 * on first read/patch. Category flags gate WHICH events land in the feed;
 * email/sms flags are forward placeholders for channel adapters (the MVP
 * ships the in-app feed only — no real vendor sends happen).
 */
export const notificationPreferences = pgTable('notification_preferences', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  orderUpdates: boolean('order_updates').notNull().default(true),
  paymentUpdates: boolean('payment_updates').notNull().default(true),
  deliveryUpdates: boolean('delivery_updates').notNull().default(true),
  marketing: boolean('marketing').notNull().default(false),
  emailEnabled: boolean('email_enabled').notNull().default(false),
  smsEnabled: boolean('sms_enabled').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type NotificationPreferences = typeof notificationPreferences.$inferSelect;
export type NewNotificationPreferences = typeof notificationPreferences.$inferInsert;
