'use client';

import { useState } from 'react';
import type { AdminStoreRow } from '@bokku/shared';

import { useAdminStores, useUpdateAdminStoreStatus } from '@/hooks/use-admin';
import { ApiError } from '@/lib/api-client';
import { formatKobo } from '@/lib/money';

/**
 * Store oversight + lifecycle. Deactivating a store stops NEW business at
 * checkout (409 STORE_INACTIVE) while in-flight orders keep their
 * lifecycle — staff keep working in /bokku regardless.
 */
export default function AdminStoresPage() {
  const storesQuery = useAdminStores();
  const statusMutation = useUpdateAdminStoreStatus();
  const [note, setNote] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  function toggleStatus(store: AdminStoreRow) {
    setNote(null);
    const next = store.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE';
    statusMutation.mutate(
      { storeId: store.id, status: next },
      {
        onSuccess: (updated) =>
          setNote({
            tone: 'ok',
            text:
              updated.status === 'ACTIVE'
                ? `${updated.name} is taking orders again.`
                : `${updated.name} deactivated — new checkouts are blocked, in-flight orders continue.`,
          }),
        onError: (err) =>
          setNote({
            tone: 'error',
            text: err instanceof ApiError ? err.message : 'The change failed — try again.',
          }),
      },
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Stores</h1>

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

      {storesQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="h-28 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : storesQuery.isError || !storesQuery.data ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-700">Couldn&apos;t load stores.</p>
        </section>
      ) : (
        <ul className="space-y-3">
          {storesQuery.data.map((store) => (
            <li key={store.id} className="rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">
                    {store.name}{' '}
                    <span className="ml-1 rounded-md bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">
                      {store.code}
                    </span>
                  </p>
                  <p className="text-xs text-slate-400">
                    {store.city}, {store.state} · since{' '}
                    {new Date(store.createdAt).toLocaleDateString('en-NG', { dateStyle: 'medium' })}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                      store.status === 'ACTIVE'
                        ? 'bg-emerald-100 text-emerald-700'
                        : store.status === 'SUSPENDED'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-slate-100 text-slate-500'
                    }`}
                  >
                    {store.status.toLowerCase()}
                  </span>
                  <button
                    type="button"
                    disabled={statusMutation.isPending || store.status === 'SUSPENDED'}
                    onClick={() => toggleStatus(store)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                      store.status === 'ACTIVE'
                        ? 'bg-red-50 text-red-700 ring-1 ring-red-200 hover:bg-red-100'
                        : 'bg-emerald-600 text-white hover:bg-emerald-700'
                    }`}
                  >
                    {store.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
                  </button>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-100 pt-4 text-sm sm:grid-cols-3">
                <Row label="Staff" value={String(store.staffCount)} />
                <Row label="Products" value={String(store.productCount)} />
                <Row label="Orders (all time)" value={String(store.totalOrders)} />
                <Row label="Orders today" value={String(store.todayOrders)} />
                <Row label="Revenue today" value={formatKobo(store.todayRevenue)} />
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-400">{label}</dt>
      <dd className="mt-0.5 font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
