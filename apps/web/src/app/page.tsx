import Link from 'next/link';
import { Suspense } from 'react';

import { AccountMenu } from '@/components/account-menu';
import { CartButton } from '@/components/cart-button';
import { HealthStatus } from '@/components/health-status';
import { Storefront } from '@/components/storefront';
import { fetchFirstStore } from '@/lib/catalogue-api';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  // MVP has a single store; later this becomes a store selector.
  const store = await fetchFirstStore().catch(() => null);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-10 sm:max-w-2xl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-brand-600">
            Bokku Logistics
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight">Shop Bokku. Delivered fast.</h1>
        </div>
        <div className="flex items-center gap-2">
          <CartButton />
          <AccountMenu />
        </div>
      </header>

      {store ? (
        <>
          <p className="text-sm text-slate-500">
            {store.description ?? 'Your neighborhood essentials'} · {store.city}
            {store.openingTime &&
              ` · Open ${store.openingTime.slice(0, 5)}–${store.closingTime?.slice(0, 5)}`}
          </p>
          <Suspense fallback={<div className="h-40 animate-pulse rounded-2xl bg-slate-100" />}>
            <Storefront storeId={store.id} />
          </Suspense>
        </>
      ) : (
        <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
          The store catalogue is unavailable right now.
        </p>
      )}

      <details className="text-xs text-slate-400">
        <summary className="cursor-pointer">Platform status</summary>
        <div className="pt-3">
          <HealthStatus />
        </div>
      </details>

      <footer className="mt-auto text-xs text-slate-400">
        <Link href="/api/health" className="underline underline-offset-2">
          health endpoint
        </Link>{' '}
        · API docs served by the API at /api/docs
      </footer>
    </main>
  );
}
