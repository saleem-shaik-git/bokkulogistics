'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CartButton } from '@/components/cart-button';
import { StatusChip } from '@/components/status-chip';
import { useOrders } from '@/hooks/use-orders';
import { formatKobo } from '@/lib/money';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Order history. Polls while any order is still in flight so status chips
 * update themselves as Bokku staff progress fulfillment.
 */
export default function OrdersPage() {
  const router = useRouter();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const user = useAuthStore((s) => s.user);
  useEffect(() => {
    if (hydrated && !user) router.replace('/login?next=%2Forders');
  }, [hydrated, user, router]);

  const ordersQuery = useOrders();

  if (!hydrated || !user) {
    return <main className="mx-auto min-h-dvh w-full max-w-md px-5 py-10 sm:max-w-2xl" />;
  }

  const orders = ordersQuery.data?.data ?? [];
  const meta = ordersQuery.data?.meta;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-6 px-5 py-8 sm:max-w-2xl">
      <header className="flex items-center justify-between">
        <div>
          <Link href="/" className="text-sm font-medium text-brand-600 hover:underline">
            ← Continue shopping
          </Link>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">My orders</h1>
        </div>
        <CartButton />
      </header>

      {ordersQuery.isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : ordersQuery.isError ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-700">
            We couldn&apos;t load your orders. Please try again.
          </p>
        </section>
      ) : orders.length === 0 ? (
        <section className="rounded-2xl border border-dashed border-slate-300 p-8 text-center">
          <p className="font-semibold text-slate-700">No orders yet</p>
          <p className="mt-1 text-sm text-slate-400">
            Your paid orders will appear here with live tracking.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
          >
            Start shopping
          </Link>
        </section>
      ) : (
        <>
          <ul className="space-y-3">
            {orders.map((order) => (
              <li key={order.id}>
                <Link
                  href={`/orders/${order.id}`}
                  className="flex items-center justify-between gap-4 rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-brand-300 hover:shadow-sm"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900">
                      {order.orderNumber}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-400">
                      {new Date(order.createdAt).toLocaleString('en-NG', {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                      })}
                      {' · '}
                      {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <span className="text-sm font-bold text-slate-900">
                      {formatKobo(order.total)}
                    </span>
                    <StatusChip status={order.status} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
          {meta && (
            <p className="text-center text-xs text-slate-400">
              {meta.total} {meta.total === 1 ? 'order' : 'orders'}
              {meta.totalPages > 1 ? ` · page ${meta.page} of ${meta.totalPages}` : ''}
            </p>
          )}
        </>
      )}
    </main>
  );
}

/** Status chip lives in components/status-chip (shared with the staff area). */
