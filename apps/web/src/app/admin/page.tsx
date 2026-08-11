'use client';

import Link from 'next/link';
import { DELIVERY_STATUS_LABELS, ORDER_STATUS_LABELS } from '@bokku/shared';

import { useAdminDashboard, useAdminOrders } from '@/hooks/use-admin';
import { StatusChip } from '@/components/status-chip';
import { formatKobo } from '@/lib/money';

/**
 * Platform overview: cross-store headline numbers (UTC today + all time),
 * live delivery pressure, user base makeup, and the newest orders.
 */
export default function AdminOverviewPage() {
  const dashboardQuery = useAdminDashboard();
  const recentQuery = useAdminOrders({}, 1);

  const d = dashboardQuery.data;
  const recent = recentQuery.data?.data.slice(0, 5) ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Platform — today so far</h1>

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
            <StatCard label="Orders today" value={String(d.todayOrders)} href="/admin/orders" />
            <StatCard label="Revenue today" value={formatKobo(d.todayRevenue)} />
            <StatCard
              label="Couriers active"
              value={String(d.activeDeliveries)}
              tone={d.activeDeliveries > 0 ? 'warn' : 'plain'}
              href="/bokku/orders"
            />
            <StatCard
              label="Users (new today)"
              value={`${d.totalUsers} (+${d.newUsersToday})`}
              href="/admin/users"
            />
            <StatCard
              label="Suspended users"
              value={String(d.suspendedUsers)}
              tone={d.suspendedUsers > 0 ? 'warn' : 'plain'}
              href="/admin/users"
            />
            <StatCard
              label="Stores active"
              value={`${d.activeStores}/${d.totalStores}`}
              href="/admin/stores"
            />
          </div>

          <section className="rounded-2xl border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold">All time</h2>
            <p className="mt-1 text-sm text-slate-600">
              <span className="font-semibold text-slate-900">{d.allTimeOrders}</span> orders ·{' '}
              <span className="font-semibold text-slate-900">{formatKobo(d.allTimeRevenue)}</span>{' '}
              collected (excludes cancelled/refunded)
            </p>
            <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Orders by status
            </h3>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {Object.entries(d.ordersByStatus).map(([status, n]) => (
                <span
                  key={status}
                  className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600"
                >
                  {ORDER_STATUS_LABELS[status as keyof typeof ORDER_STATUS_LABELS]} · {n}
                </span>
              ))}
              {Object.keys(d.ordersByStatus).length === 0 && (
                <span className="text-sm text-slate-400">No orders yet.</span>
              )}
            </div>
            {Object.keys(d.deliveriesByStatus).length > 0 && (
              <>
                <h3 className="mt-4 text-xs font-semibold uppercase tracking-wide text-slate-400">
                  Deliveries by courier status
                </h3>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {Object.entries(d.deliveriesByStatus).map(([status, n]) => (
                    <span
                      key={status}
                      className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-600"
                    >
                      {DELIVERY_STATUS_LABELS[status as keyof typeof DELIVERY_STATUS_LABELS]} · {n}
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}

      <section className="rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
          <h2 className="text-sm font-semibold">Newest orders (all stores)</h2>
          <Link href="/admin/orders" className="text-xs font-medium text-brand-600 hover:underline">
            View all
          </Link>
        </div>
        {recent.length === 0 ? (
          <p className="px-5 py-4 text-sm text-slate-400">No orders yet today — or ever.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {recent.map((order) => (
              <li key={order.id} className="flex items-center justify-between gap-3 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">{order.orderNumber}</p>
                  <p className="text-xs text-slate-400">
                    {order.itemCount} item{order.itemCount === 1 ? '' : 's'} ·{' '}
                    {new Date(order.createdAt).toLocaleString('en-NG', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <StatusChip status={order.status} />
                  <span className="text-sm font-semibold text-slate-900">
                    {formatKobo(order.total)}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
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
  tone?: 'plain' | 'warn';
  href?: string;
}) {
  const inner = (
    <>
      <p className="text-xs font-medium text-slate-400">{label}</p>
      <p
        className={`mt-1 truncate text-xl font-bold ${tone === 'warn' ? 'text-amber-600' : 'text-slate-900'}`}
      >
        {value}
      </p>
    </>
  );
  const cls =
    'block rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-slate-300';
  return href ? (
    <Link href={href} className={cls}>
      {inner}
    </Link>
  ) : (
    <div className={cls}>{inner}</div>
  );
}
