'use client';

import Link from 'next/link';
import { ORDER_STATUS_LABELS, type OrderStatus } from '@bokku/shared';

import { StatusChip } from '@/components/status-chip';
import { useBokkuDashboard, useBokkuOrders } from '@/hooks/use-bokku';
import { formatKobo } from '@/lib/money';

/**
 * Ops overview: headline numbers for today, the fulfillment queue,
 * stock alerts, and the newest orders. Polls via the underlying hooks.
 */
export default function BokkuOverviewPage() {
  const dashboardQuery = useBokkuDashboard();
  const recentQuery = useBokkuOrders(undefined, 1);

  const d = dashboardQuery.data;
  const recent = recentQuery.data?.data.slice(0, 5) ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">
        {d ? `${d.store.name} — today so far` : 'Today so far'}
      </h1>

      {dashboardQuery.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : dashboardQuery.isError || !d ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-700">
            Couldn&apos;t load the dashboard. Please try again shortly.
          </p>
        </section>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="Orders today" value={String(d.todayOrders)} href="/bokku/orders" />
            <StatCard label="Revenue today" value={formatKobo(d.todayRevenue)} />
            <StatCard
              label="Needs fulfillment"
              value={String(d.pendingFulfillment)}
              tone={d.pendingFulfillment > 0 ? 'warn' : 'plain'}
              href="/bokku/orders"
            />
            <StatCard label="Out for delivery" value={String(d.outForDelivery)} />
            <StatCard
              label="Low stock"
              value={String(d.lowStockCount)}
              tone={d.lowStockCount > 0 ? 'warn' : 'plain'}
              href="/bokku/inventory"
            />
            <StatCard
              label="Out of stock"
              value={String(d.outOfStockCount)}
              tone={d.outOfStockCount > 0 ? 'danger' : 'plain'}
              href="/bokku/inventory"
            />
          </div>

          {d.lowStockAlerts.length > 0 && (
            <section className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
              <h2 className="text-sm font-semibold text-amber-900">Stock alerts</h2>
              <ul className="mt-2 divide-y divide-amber-100">
                {d.lowStockAlerts.map((row) => (
                  <li key={row.productId} className="flex items-center justify-between py-2 text-sm">
                    <span className="font-medium text-amber-900">
                      {row.productName} <span className="text-amber-500">· {row.sku}</span>
                    </span>
                    <span
                      className={`font-semibold ${row.sellable <= 0 ? 'text-red-700' : 'text-amber-700'}`}
                    >
                      {row.sellable <= 0 ? 'Out of stock' : `${row.sellable} left`}
                    </span>
                  </li>
                ))}
              </ul>
              <Link
                href="/bokku/inventory"
                className="mt-2 inline-block text-sm font-medium text-brand-700 hover:underline"
              >
                Restock in Inventory →
              </Link>
            </section>
          )}

          <section>
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-slate-900">Latest orders</h2>
              <Link
                href="/bokku/orders"
                className="text-sm font-medium text-brand-600 hover:underline"
              >
                View all →
              </Link>
            </div>
            {recentQuery.isLoading ? (
              <div className="mt-3 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
                ))}
              </div>
            ) : recent.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-400">
                No orders yet — they&apos;ll appear here as they come in.
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {recent.map((order) => (
                  <li key={order.id}>
                    <Link
                      href={`/bokku/orders/${order.id}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 transition hover:border-brand-300"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-900">
                          {order.orderNumber}
                        </p>
                        <p className="text-xs text-slate-400">
                          {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'} ·{' '}
                          {formatKobo(order.total)}
                        </p>
                      </div>
                      <span className="sr-only">
                        {ORDER_STATUS_LABELS[order.status as OrderStatus]}
                      </span>
                      <StatusChip status={order.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  tone = 'plain',
  href,
}: {
  label: string;
  value: string;
  tone?: 'plain' | 'warn' | 'danger';
  href?: string;
}) {
  const tones = {
    plain: 'border-slate-200 bg-white',
    warn: 'border-amber-200 bg-amber-50',
    danger: 'border-red-200 bg-red-50',
  }[tone];
  const content = (
    <div className={`rounded-2xl border p-4 ${tones}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold text-slate-900">{value}</p>
    </div>
  );
  return href ? (
    <Link href={href} className="transition hover:opacity-80">
      {content}
    </Link>
  ) : (
    content
  );
}
