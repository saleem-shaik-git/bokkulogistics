'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';

import { isPlatformAdmin } from '@/hooks/use-admin';
import { useAuthStore } from '@/stores/auth-store';

const NAV = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/stores', label: 'Stores' },
  { href: '/admin/orders', label: 'Orders' },
  { href: '/admin/audit', label: 'Audit trail' },
] as const;

/**
 * Platform admin shell. Client-side gate for UX only — the API enforces
 * PLATFORM_ADMIN on every /admin call regardless.
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const user = useAuthStore((s) => s.user);
  useEffect(() => {
    if (!hydrated) return;
    if (!user) router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    else if (!isPlatformAdmin(user.role)) router.replace('/');
  }, [hydrated, user, router, pathname]);

  if (!hydrated || !user || !isPlatformAdmin(user.role)) {
    return <main className="mx-auto min-h-dvh w-full max-w-3xl px-5 py-10" />;
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col px-5 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="rounded-lg bg-slate-900 px-2.5 py-1 text-sm font-bold text-white">
            Bokku
          </span>
          <span className="text-sm font-medium text-slate-500">Platform admin</span>
        </div>
        <Link href="/" className="text-sm font-medium text-brand-600 hover:underline">
          ← Storefront
        </Link>
      </header>

      <nav aria-label="Admin sections" className="mt-5 flex gap-1 overflow-x-auto">
        {NAV.map((item) => {
          const active =
            item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`rounded-xl px-3.5 py-2 text-sm font-medium transition ${
                active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 flex-1">{children}</div>
    </div>
  );
}
