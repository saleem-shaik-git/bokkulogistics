'use client';

import { useAdminStores } from '@/hooks/use-admin';
import { formatKobo } from '@/lib/money';

/**
 * Store oversight (read-only): every store with staff/product counts and
 * today's trading numbers. Store lifecycle mutations are a post-MVP lever
 * — the platform ships one store and fulfillment lives in /bokku.
 */
export default function AdminStoresPage() {
  const storesQuery = useAdminStores();

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Stores</h1>

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
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${
                    store.status === 'ACTIVE'
                      ? 'bg-emerald-100 text-emerald-700'
                      : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {store.status.toLowerCase()}
                </span>
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
