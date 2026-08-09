'use client';

import { useQuery } from '@tanstack/react-query';

import { fetchHealth } from '@/lib/api';

const DOT: Record<string, string> = {
  up: 'bg-brand-500',
  down: 'bg-red-500',
};

/** Live snapshot of the API / database / redis probes. Proves the full stack is wired. */
export function HealthStatus() {
  const { data, isLoading, isError, dataUpdatedAt } = useQuery({
    queryKey: ['health'],
    queryFn: fetchHealth,
    refetchInterval: 15_000,
  });

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          Platform status
        </h2>
        {isLoading ? (
          <span className="text-xs text-slate-400">checking…</span>
        ) : (
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              data?.status === 'ok' ? 'bg-brand-50 text-brand-700' : 'bg-red-50 text-red-700'
            }`}
          >
            {isError ? 'error' : data?.status}
          </span>
        )}
      </div>
      <ul className="space-y-2">
        {(['api', 'database', 'redis'] as const).map((service) => (
          <li key={service} className="flex items-center justify-between text-sm">
            <span className="capitalize text-slate-600">{service}</span>
            <span className="flex items-center gap-2">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  DOT[data?.services?.[service] ?? 'down']
                }`}
              />
              <span className="text-slate-500">{data?.services?.[service] ?? '—'}</span>
            </span>
          </li>
        ))}
      </ul>
      {dataUpdatedAt > 0 && (
        <p className="mt-3 text-right text-xs text-slate-400">
          updated {new Date(dataUpdatedAt).toLocaleTimeString()}
        </p>
      )}
    </div>
  );
}
