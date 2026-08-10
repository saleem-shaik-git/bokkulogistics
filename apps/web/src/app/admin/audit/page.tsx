'use client';

import { useState } from 'react';

import { useAdminAuditLogs } from '@/hooks/use-admin';
import { Pager } from '../users/page';

const ACTION_EXAMPLES = ['admin', 'order', 'auth.login', 'payment', 'delivery', 'inventory'];

/**
 * Audit trail reader. Newest first; the action filter is a prefix match
 * server-side ("order" → order.*). Metadata expands per row for forensics.
 */
export default function AdminAuditPage() {
  const [input, setInput] = useState('');
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);

  const logsQuery = useAdminAuditLogs(action, page);
  const data = logsQuery.data;

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold tracking-tight">Audit trail</h1>

      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setAction(input.trim());
          setPage(1);
        }}
      >
        <input
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Filter by action prefix (e.g. order)…"
          aria-label="Filter by action"
          className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-300"
        />
        <button
          type="submit"
          className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
        >
          Filter
        </button>
      </form>
      <div className="flex flex-wrap gap-1.5">
        {ACTION_EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => {
              setInput(example);
              setAction(example);
              setPage(1);
            }}
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${
              action === example
                ? 'bg-slate-900 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {example}.*
          </button>
        ))}
      </div>

      {logsQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : logsQuery.isError || !data ? (
        <section className="rounded-2xl border border-red-200 bg-red-50 p-6 text-center">
          <p className="text-sm font-medium text-red-700">Couldn&apos;t load the audit trail.</p>
        </section>
      ) : (
        <>
          <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
            <ul className="divide-y divide-slate-100">
              {data.data.map((log) => (
                <li key={log.id} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-mono text-xs font-semibold text-slate-800">{log.action}</p>
                    <p className="text-xs text-slate-400">
                      {new Date(log.createdAt).toLocaleString('en-NG', {
                        dateStyle: 'medium',
                        timeStyle: 'medium',
                      })}
                    </p>
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {log.actor ? (
                      <>
                        {log.actor.firstName} {log.actor.lastName} ({log.actor.email})
                      </>
                    ) : (
                      'system / anonymous'
                    )}
                    {log.entityType && (
                      <>
                        {' '}
                        → {log.entityType} <span className="font-mono">{log.entityId}</span>
                      </>
                    )}
                    {log.ipAddress && <> · ip {log.ipAddress}</>}
                  </p>
                  {log.metadata && Object.keys(log.metadata).length > 0 && (
                    <details className="mt-1.5">
                      <summary className="cursor-pointer text-xs font-medium text-brand-600">
                        metadata
                      </summary>
                      <pre className="mt-1 overflow-x-auto rounded-lg bg-slate-50 p-2.5 text-[11px] text-slate-600">
                        {JSON.stringify(log.metadata, null, 2)}
                      </pre>
                    </details>
                  )}
                </li>
              ))}
              {data.data.length === 0 && (
                <li className="px-4 py-6 text-center text-sm text-slate-400">
                  Nothing matches this filter yet.
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
