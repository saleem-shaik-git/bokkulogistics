/**
 * Notification feed contracts (Phase 11). In-app feed only — email/sms
 * flags are forward placeholders for channel adapters; no real vendor
 * sends happen in the MVP. Delivery is polling-first (badge polls the
 * unread count; no websockets).
 */

/** One feed row. `data` deep-links the tap target (order id/number, …). */
export interface PublicNotification {
  id: string;
  /** Dotted machine type, e.g. "order.paid", "delivery.delivered". */
  type: string;
  title: string;
  body: string;
  data: Record<string, unknown> | null;
  readAt: string | null;
  createdAt: string;
}

export interface PublicNotificationPreferences {
  orderUpdates: boolean;
  paymentUpdates: boolean;
  deliveryUpdates: boolean;
  marketing: boolean;
  /** Channel toggles — placeholders until channel adapters land. */
  emailEnabled: boolean;
  smsEnabled: boolean;
}

/** Unread badge payload (`GET /notifications/unread-count`). */
export interface NotificationUnreadCount {
  unread: number;
}
