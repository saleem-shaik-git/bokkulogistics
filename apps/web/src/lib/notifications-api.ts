import type {
  NotificationUnreadCount,
  Paginated,
  PublicNotification,
  PublicNotificationPreferences,
} from '@bokku/shared';

import { authedRequest } from './authed-api';

/**
 * In-app notification feed (Phase 11). Polling-first: the header badge
 * polls the unread count; no websockets in the MVP.
 */
export function fetchNotifications(params: {
  page?: number;
  limit?: number;
  unread?: boolean;
}): Promise<Paginated<PublicNotification>> {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  if (params.unread) search.set('unread', 'true');
  const qs = search.toString();
  return authedRequest<Paginated<PublicNotification>>(`/notifications${qs ? `?${qs}` : ''}`);
}

export function fetchUnreadCount(): Promise<NotificationUnreadCount> {
  return authedRequest<NotificationUnreadCount>('/notifications/unread-count');
}

export function markNotificationRead(id: string): Promise<PublicNotification> {
  return authedRequest<PublicNotification>(`/notifications/${encodeURIComponent(id)}/read`, {
    method: 'PATCH',
  });
}

export function markAllNotificationsRead(): Promise<{ updated: number }> {
  return authedRequest<{ updated: number }>('/notifications/read-all', { method: 'POST' });
}

export function fetchNotificationPreferences(): Promise<PublicNotificationPreferences> {
  return authedRequest<PublicNotificationPreferences>('/notifications/preferences');
}

export function updateNotificationPreferences(
  patch: Partial<PublicNotificationPreferences>,
): Promise<PublicNotificationPreferences> {
  return authedRequest<PublicNotificationPreferences>('/notifications/preferences', {
    method: 'PATCH',
    body: patch,
  });
}
