'use client';

import Link from 'next/link';
import { useState } from 'react';
import {
  ORDER_STATUS_LABELS,
  ORDER_TERMINAL_STATUSES,
  type OrderStatus,
  type PublicOrderSummary,
} from '@bokku/shared';

import { StatusChip } from '@/components/status-chip';
import {
  OPS_CANCELLABLE,
  OPS_NEXT_STEP,
  useBokkuOrders,
  useTransitionBokkuOrder,
} from '@/hooks/use-bokku';
import { ApiError } from '@/lib/api-client';
import { formatKobo } from '@/lib/money';

const TABS: Array<{ value: OrderStatus | 'ALL'; label: string }> = [
  { value: 'PAID', label: 'New (paid)' },
  { value: 'CONFIRMED', label: 'Confirmed' },
  { value: 'PREPARING', label: 'Preparing' },
  { value: 'READY_FOR_PICKUP', label: 'Ready' },
  { value: 'DELIVERY_REQUESTED', label: 'Rider requested' },
  { value: 'DRIVER_ASSIGNED', label: 'Rider assigned' },
  { value: 'OUT_FOR_DELIVERY', label: 'Delivering' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'CANCELLED', label: 'Cancelled' },
  { value: 'ALL', label: 'All' },
];

/**
 * The fulfillment queue. Each row exposes the one legal next step
 * (server-side state policy re-checks it) and links to the detail page for
 * cancellations/refunds. Polls while open in any tab.
 */
export default function BokkuOrdersPage() {
  const [tab, setTab] = useState<OrderStatus | 'ALL'>('PAID');
  const ordersQuery = useBokkuOrders(tab === 'ALL' ? undefined : tab);

  const orders = ordersQuery.data?.data ?? [];
  const meta = ordersQuery.data?.meta;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Orders</h1>

      <div className="flex gap-1 overflow-x-auto pb-1">
        {TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setTab(t.value)}
            aria-pressed={tab === t.value}
            className={`whitespace-nowrap rounded-full px-3 py-1.5 text-xs font-semibold transition ${
              tab === t.value ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-600'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {ordersQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : ordersQuery.isError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-center text-sm font-medium text-red-700">
          Couldn&apos;t load orders. Please try again.
        </p>
      ) : orders.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
          {tab === 'ALL'
            ? 'No orders yet.'
            : `No ${ORDER_STATUS_LABELS[tab].toLowerCase()} orders.`}
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {orders.map((order) => (
              <OrderRow key={order.id} order={order} />
            ))}
          </ul>
          {meta && meta.total > meta.limit && (
            <p className="text-center text-xs text-slate-400">
              Showing {orders.length} of {meta.total} — narrow with the tabs above.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function OrderRow({ order }: { order: PublicOrderSummary }) {
  const transition = useTransitionBokkuOrder();
  const [actionError, setActionError] = useState<string | null>(null);
  const next = OPS_NEXT_STEP[order.status];
  const terminal = ORDER_TERMINAL_STATUSES.includes(order.status);

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <Link href={`/bokku/orders/${order.id}`} className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-slate-900">{order.orderNumber}</p>
          <p className="mt-0.5 text-xs text-slate-400">
            {new Date(order.createdAt).toLocaleString('en-NG', {
              dateStyle: 'medium',
              timeStyle: 'short',
            })}
            {' · '}
            {order.itemCount} {order.itemCount === 1 ? 'item' : 'items'}
          </p>
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-sm font-bold">{formatKobo(order.total)}</span>
          <StatusChip status={order.status} />
        </div>
      </div>

      {!terminal && (
        <div className="mt-3 flex items-center gap-2 border-t border-slate-100 pt-3">
          {next ? (
            <button
              type="button"
              disabled={transition.isPending}
              onClick={() => {
                setActionError(null);
                transition.mutate(
                  { orderId: order.id, status: next.to },
                  {
                    onError: (err) =>
                      setActionError(err instanceof ApiError ? err.message : 'Action failed'),
                  },
                );
              }}
              className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
            >
              {transition.isPending ? 'Updating…' : next.label}
            </button>
          ) : (
            <span className="text-xs text-slate-400">
              {order.status === 'READY_FOR_PICKUP'
                ? 'Awaiting delivery dispatch'
                : 'In delivery — tracked automatically'}
            </span>
          )}
          {OPS_CANCELLABLE.includes(order.status) && (
            <Link
              href={`/bokku/orders/${order.id}#cancel`}
              className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50"
            >
              Cancel & refund
            </Link>
          )}
          <Link
            href={`/bokku/orders/${order.id}`}
            className="ml-auto text-xs font-medium text-brand-600 hover:underline"
          >
            Details →
          </Link>
        </div>
      )}
      {actionError && <p className="mt-2 text-xs font-medium text-red-600">{actionError}</p>}
    </li>
  );
}
