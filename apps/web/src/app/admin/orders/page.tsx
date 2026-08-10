'use client';

import Link from 'next/link';
import { useState } from 'react';
import { ORDER_STATUSES, ORDER_STATUS_LABELS, type OrderStatus } from '@bokku/shared';

import { StatusChip } from '@/components/status-chip';
import { useAdminOrders, useAdminStores, useRetryAdminRefund } from '@/hooks/use-admin';
import { ApiError } from '@/lib/api-client';
import { formatKobo } from '@/lib/money';
import { Pager } from '../users/page';

/**
 * Cross-store order oversight. Rows deep-link into the ops detail
 * (/bokku/orders/[id]) — PLATFORM_ADMIN bypasses the store-staff guard
 * server-side. REFUND_PENDING rows expose the provider-refund retry
 * (the only refund mutation available to the platform admin).
 */
export default function AdminOrdersPage() {
  const [status, setStatus] = useState<OrderStatus | ''>('');
  const [storeId, setStoreId] = useState('');
  const [page, setPage] = useState(1);
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const filters = {
    ...(status ? { status } : {}),
    ...(storeId ? { storeId } : {}),
  };
  const ordersQuery = useAdminOrders(filters, page);
  const storesQuery = useAdminStores();
  const retryRefund = useRetryAdminRefund();

  const data = ordersQuery.data;

  function retry(orderNumber: string, orderId: string) {
    setNote(null);
    retryRefund.mutate(orderId, {
      onSuccess: () =>
        setNote({ tone: 'ok', text: `${orderNumber} refunded — money is on its way back.` }),
      onError: (err) =>
        setNote({
          tone: 'error',
          text: err instanceof ApiError ? err.message : 'The retry failed — try again.',
        }),
    });
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Orders — all stores</h1>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value as OrderStatus | '');
            setPage(1);
          }}
          aria-label="Filter by status"
          className="rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-sm"
        >
          <option value="">All statuses</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {ORDER_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          value={storeId}
          onChange={(e) => {
            setStoreId(e.target.value);
            setPage(1);
          }}
          aria-label="Filter by store"
          className="rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-sm"
        >
          <option value="">All stores</option>
          {(storesQuery.data ?? []).map((store) => (
            <option key={store.id} value={store.id}>
              {store.name}
            </option>
          ))}
        </select>
      </div>

      {note && (
        <p
          role="status"
          className={`rounded-xl px-4 py-2.5 text-sm font-medium ${
            note.tone === 'ok'
              ? 'border border-emerald-200 bg-emerald-50 text-emerald-800'
              : 'border border-red-200 bg-red-50 text-red-700'
          }`}
        >
          {note.text}
        </p>
      )}

      {ordersQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : ordersQuery.isError || !data ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-700">Couldn&apos;t load orders.</p>
        </section>
      ) : (
        <>
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <ul className="divide-y divide-slate-100">
              {data.data.map((order) => (
                <li key={order.id}>
                  <Link
                    href={`/bokku/orders/${order.id}`}
                    className="flex items-center justify-between gap-3 px-4 py-3 transition hover:bg-slate-50"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-slate-800">
                        {order.orderNumber}
                      </p>
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
                  </Link>
                  {order.status === 'REFUND_PENDING' && (
                    <div className="border-t border-amber-100 bg-amber-50 px-4 py-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-xs text-amber-800">
                          The provider refund failed earlier — retry it.
                        </p>
                        <button
                          type="button"
                          disabled={retryRefund.isPending}
                          onClick={() => retry(order.orderNumber, order.id)}
                          className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                        >
                          {retryRefund.isPending ? 'Retrying…' : 'Retry refund'}
                        </button>
                      </div>
                    </div>
                  )}
                </li>
              ))}
              {data.data.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-slate-400">
                  No orders match these filters.
                </li>
              )}
            </ul>
          </section>

          <Pager
            page={data.meta.page}
            totalPages={data.meta.totalPages}
            total={data.meta.total}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}
