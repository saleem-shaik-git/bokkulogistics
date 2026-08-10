'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { useUnreadNotificationCount } from '@/hooks/use-notifications';
import { useAuthStore } from '@/stores/auth-store';

/** Header bell with an unread-count badge; links to the notification feed. */
export function NotificationBell() {
  // Hydration guard: the persisted session only exists on the client.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const user = useAuthStore((s) => s.user);
  const { data: unread } = useUnreadNotificationCount();

  const count = hydrated && user ? (unread?.unread ?? 0) : 0;

  return (
    <Link
      href="/notifications"
      aria-label={count > 0 ? `Notifications, ${count} unread` : 'Notifications'}
      className="relative rounded-xl border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-100"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
        aria-hidden
      >
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
      {count > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-bold text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </Link>
  );
}
