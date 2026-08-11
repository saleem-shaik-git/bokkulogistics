'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PublicNotificationPreferences } from '@bokku/shared';

import * as notificationsApi from '@/lib/notifications-api';
import { useAuthStore } from '@/stores/auth-store';

export function notificationsQueryKey(userId: string | undefined) {
  return ['notifications', userId ?? 'anonymous'] as const;
}

export function unreadCountQueryKey(userId: string | undefined) {
  return [...notificationsQueryKey(userId), 'unread-count'] as const;
}

/**
 * Unread count for the header bell. Polls on a steady beat while signed in
 * — polling-first real-time (no websockets in the MVP).
 */
export function useUnreadNotificationCount() {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: unreadCountQueryKey(user?.id),
    queryFn: () => notificationsApi.fetchUnreadCount(),
    enabled: !!user,
    refetchInterval: 15_000,
  });
}

/** My notification feed (optionally unread-only), newest first. */
export function useNotifications(options: { page?: number; unreadOnly?: boolean } = {}) {
  const user = useAuthStore((s) => s.user);
  const page = options.page ?? 1;
  const unreadOnly = options.unreadOnly ?? false;
  return useQuery({
    queryKey: [...notificationsQueryKey(user?.id), 'feed', page, unreadOnly],
    queryFn: () =>
      notificationsApi.fetchNotifications({ page, limit: 20, unread: unreadOnly || undefined }),
    enabled: !!user,
    // Keep the badge bell honest while the feed page is open.
    refetchInterval: 15_000,
  });
}

/** Mark one notification read; idempotent server-side. */
export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationsApi.markNotificationRead(id),
    onSettled: () => {
      const userId = useAuthStore.getState().user?.id;
      void queryClient.invalidateQueries({ queryKey: notificationsQueryKey(userId) });
    },
  });
}

/** Mark every notification read. */
export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => notificationsApi.markAllNotificationsRead(),
    onSettled: () => {
      const userId = useAuthStore.getState().user?.id;
      void queryClient.invalidateQueries({ queryKey: notificationsQueryKey(userId) });
    },
  });
}

/** My feed preferences, materialized lazily server-side. */
export function useNotificationPreferences() {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: [...notificationsQueryKey(user?.id), 'preferences'],
    queryFn: () => notificationsApi.fetchNotificationPreferences(),
    enabled: !!user,
    staleTime: 30_000,
  });
}

/** Merge-patch one or more preference toggles. */
export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<PublicNotificationPreferences>) =>
      notificationsApi.updateNotificationPreferences(patch),
    onSuccess: (updated) => {
      const userId = useAuthStore.getState().user?.id;
      queryClient.setQueryData([...notificationsQueryKey(userId), 'preferences'], updated);
    },
  });
}
