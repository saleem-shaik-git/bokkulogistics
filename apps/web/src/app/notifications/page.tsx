'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotificationPreferences,
  useNotifications,
  useUpdateNotificationPreferences,
} from '@/hooks/use-notifications';
import { useAuthStore } from '@/stores/auth-store';
import type { PublicNotification, PublicNotificationPreferences } from '@bokku/shared';

/**
 * In-app notification feed (Phase 11). Polling-first: this page re-polls on
 * a steady beat instead of websockets. Tapping an unread row marks it read
 * and deep-links to the related order when the payload carries one.
 */
export default function NotificationsPage() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const user = useAuthStore((s) => s.user);
  useEffect(() => {
    if (hydrated && !user) router.replace('/login?next=%2Fnotifications');
  }, [hydrated, user, router]);

  const [unreadOnly, setUnreadOnly] = useState(false);
  const feedQuery = useNotifications({ unreadOnly });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  if (!hydrated || !user) {
    return <main className="mx-auto min-h-dvh w-full max-w-md px-5 py-10 sm:max-w-2xl" />;
  }

  const notifications = feedQuery.data?.data ?? [];
  const hasUnread = notifications.some((n) => !n.readAt);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-8 sm:max-w-2xl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <Link href="/" className="text-sm font-medium text-brand-600 hover:underline">
            ← Continue shopping
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">Notifications</h1>
        </div>
        <button
          type="button"
          onClick={() => markAll.mutate()}
          disabled={markAll.isPending || !hasUnread}
          className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
        >
          {markAll.isPending ? '…' : 'Mark all read'}
        </button>
      </header>

      <nav className="flex gap-2" aria-label="Filter notifications">
        {(
          [
            { key: false, label: 'All' },
            { key: true, label: 'Unread' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.label}
            type="button"
            onClick={() => setUnreadOnly(tab.key)}
            aria-pressed={unreadOnly === tab.key}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              unreadOnly === tab.key
                ? 'bg-brand-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {feedQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : feedQuery.isError ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-700">
            We couldn&apos;t load your notifications. Please try again.
          </p>
        </section>
      ) : notifications.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 p-8 text-center">
          <p className="text-sm text-slate-500">
            {unreadOnly
              ? 'You’re all caught up.'
              : 'Nothing here yet — order updates will show up here.'}
          </p>
        </section>
      ) : (
        <ul className="space-y-3">
          {notifications.map((notification) => (
            <NotificationRow
              key={notification.id}
              notification={notification}
              onOpen={() => {
                if (!notification.readAt && !markRead.isPending) {
                  markRead.mutate(notification.id);
                }
              }}
            />
          ))}
        </ul>
      )}

      <PreferencesSection />
    </main>
  );
}

function NotificationRow({
  notification,
  onOpen,
}: {
  notification: PublicNotification;
  onOpen: () => void;
}) {
  const orderId = notification.data?.orderId;
  const href = typeof orderId === 'string' ? `/orders/${orderId}` : undefined;

  const created = new Date(notification.createdAt).toLocaleString('en-NG', {
    dateStyle: 'medium',
    timeStyle: 'short',
  });

  const inner = (
    <div className="flex items-start gap-3">
      <span
        aria-hidden
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
          notification.readAt ? 'bg-slate-300' : 'bg-brand-600'
        }`}
      />
      <div className="min-w-0">
        <p
          className={`text-sm ${notification.readAt ? 'text-slate-600' : 'font-semibold text-slate-900'}`}
        >
          {notification.title}
        </p>
        <p className="mt-0.5 text-sm text-slate-500">{notification.body}</p>
        <p className="mt-1 text-xs text-slate-400">{created}</p>
      </div>
    </div>
  );

  const className = `block rounded-2xl border p-4 transition ${
    notification.readAt
      ? 'border-slate-200 bg-white'
      : 'border-brand-100 bg-brand-50 hover:border-brand-200'
  }`;

  return (
    <li>
      {href ? (
        <Link href={href} onClick={onOpen} className={className}>
          {inner}
        </Link>
      ) : (
        <button type="button" onClick={onOpen} className={`${className} w-full text-left`}>
          {inner}
        </button>
      )}
    </li>
  );
}

const FEED_TOGGLES: Array<{
  key: keyof Pick<
    PublicNotificationPreferences,
    'orderUpdates' | 'paymentUpdates' | 'deliveryUpdates' | 'marketing'
  >;
  label: string;
  hint: string;
}> = [
  { key: 'orderUpdates', label: 'Order updates', hint: 'Confirmations, preparation, delivery.' },
  { key: 'paymentUpdates', label: 'Payment updates', hint: 'Settlements and refunds.' },
  {
    key: 'deliveryUpdates',
    label: 'Courier updates',
    hint: 'Rider assigned, arriving, delivered.',
  },
  { key: 'marketing', label: 'Offers & news', hint: 'Promotions from Bokku stores.' },
];

const CHANNEL_TOGGLES: Array<{
  key: keyof Pick<PublicNotificationPreferences, 'emailEnabled' | 'smsEnabled'>;
  label: string;
}> = [
  { key: 'emailEnabled', label: 'Email' },
  { key: 'smsEnabled', label: 'SMS' },
];

function PreferencesSection() {
  const prefsQuery = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();
  const prefs = prefsQuery.data;

  return (
    <section className="rounded-2xl border border-slate-200 p-5">
      <h2 className="text-sm font-semibold text-slate-900">Notification settings</h2>
      <p className="mt-0.5 text-xs text-slate-500">Choose which updates appear in your feed.</p>

      {prefsQuery.isLoading || !prefs ? (
        <div className="mt-4 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-9 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : (
        <ul className="mt-4 divide-y divide-slate-100">
          {FEED_TOGGLES.map((toggle) => (
            <li key={toggle.key} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">{toggle.label}</p>
                <p className="text-xs text-slate-500">{toggle.hint}</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={prefs[toggle.key]}
                aria-label={toggle.label}
                disabled={update.isPending}
                onClick={() => update.mutate({ [toggle.key]: !prefs[toggle.key] })}
                className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:opacity-50 ${
                  prefs[toggle.key] ? 'bg-brand-600' : 'bg-slate-300'
                }`}
              >
                <span
                  className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${
                    prefs[toggle.key] ? 'left-[22px]' : 'left-0.5'
                  }`}
                />
              </button>
            </li>
          ))}
          {CHANNEL_TOGGLES.map((toggle) => (
            <li key={toggle.key} className="flex items-center justify-between gap-4 py-3">
              <div>
                <p className="text-sm font-medium text-slate-800">{toggle.label}</p>
                <p className="text-xs text-slate-400">Coming soon — in-app only for now.</p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={false}
                aria-label={toggle.label}
                disabled
                className="relative h-6 w-11 shrink-0 rounded-full bg-slate-200 opacity-60"
              >
                <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {update.isError && (
        <p className="mt-3 text-xs text-red-600">
          Couldn&apos;t save your settings — please try again.
        </p>
      )}
    </section>
  );
}
