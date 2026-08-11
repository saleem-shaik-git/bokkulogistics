'use client';

import { useState } from 'react';
import type { OpsInventoryRow } from '@bokku/shared';

import { useAdjustBokkuInventory, useBokkuInventory } from '@/hooks/use-bokku';
import { ApiError } from '@/lib/api-client';

/**
 * Stock control: on-hand / reserved / sellable per product with low-stock
 * flags, plus adjustments (absolute set or threshold change) — every change
 * carries a reason and is audited server-side.
 */
export default function BokkuInventoryPage() {
  const inventoryQuery = useBokkuInventory();
  const [adjusting, setAdjusting] = useState<OpsInventoryRow | null>(null);

  const rows = inventoryQuery.data ?? [];
  const attention = rows.filter((r) => r.sellable <= 0 || r.lowStock);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Inventory</h1>
        {attention.length > 0 && (
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
            {attention.length} need{attention.length === 1 ? 's' : ''} attention
          </span>
        )}
      </div>

      {inventoryQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : inventoryQuery.isError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-center text-sm font-medium text-red-700">
          Couldn&apos;t load inventory.
        </p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
          No stock rows yet — they appear when products are created.
        </p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li
              key={row.productId}
              className={`rounded-xl border p-4 ${
                row.sellable <= 0
                  ? 'border-red-200 bg-red-50/50'
                  : row.lowStock
                    ? 'border-amber-200 bg-amber-50/50'
                    : 'border-slate-200 bg-white'
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{row.productName}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {row.sku} · on hand {row.quantityOnHand}
                    {row.reservedQuantity > 0 ? ` · reserved ${row.reservedQuantity}` : ''} ·
                    threshold {row.lowStockThreshold}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`text-sm font-bold ${
                      row.sellable <= 0
                        ? 'text-red-600'
                        : row.lowStock
                          ? 'text-amber-600'
                          : 'text-slate-900'
                    }`}
                  >
                    {row.sellable <= 0 ? 'Out of stock' : `${row.sellable} sellable`}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAdjusting(row)}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Adjust
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {adjusting && <AdjustModal row={adjusting} onClose={() => setAdjusting(null)} />}
    </div>
  );
}

function AdjustModal({ row, onClose }: { row: OpsInventoryRow; onClose: () => void }) {
  const adjust = useAdjustBokkuInventory();
  const [mode, setMode] = useState<'set' | 'delta'>('set');
  const [quantity, setQuantity] = useState(String(row.quantityOnHand));
  const [threshold, setThreshold] = useState(String(row.lowStockThreshold));
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    const q = Number(quantity);
    if (!Number.isInteger(q) || (mode === 'set' && q < 0))
      return setError(
        mode === 'set'
          ? 'On-hand quantity must be a whole number ≥ 0.'
          : 'The adjustment must be a whole number.',
      );
    if (mode === 'delta' && q === 0) return setError('Enter a non-zero adjustment.');
    const t = Number(threshold);
    if (!Number.isInteger(t) || t < 0) return setError('Threshold must be a whole number ≥ 0.');
    if (reason.trim().length < 3) return setError('A short reason is required (audited).');

    adjust.mutate(
      {
        productId: row.productId,
        ...(mode === 'set' ? { setQuantity: q } : { adjustment: q }),
        lowStockThreshold: t,
        reason: reason.trim(),
      },
      { onSuccess: onClose, onError: (err) => setError(err instanceof ApiError ? err.message : 'Adjustment failed') },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
      <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-5">
        <h2 className="text-lg font-bold">Adjust {row.productName}</h2>
        <p className="mt-1 text-xs text-slate-400">
          On hand {row.quantityOnHand}
          {row.reservedQuantity > 0
            ? ` (${row.reservedQuantity} reserved by open orders — only ${row.sellable} sellable)`
            : ''}
        </p>

        <div className="mt-4 space-y-3">
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm font-semibold">
            {(
              [
                { value: 'set', label: 'Set exact count' },
                { value: 'delta', label: 'Add / remove' },
              ] as const
            ).map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => setMode(m.value)}
                className={`flex-1 rounded-lg py-1.5 ${mode === m.value ? 'bg-white shadow-sm' : 'text-slate-500'}`}
              >
                {m.label}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-500">
              {mode === 'set' ? 'New on-hand quantity' : 'Adjustment (e.g. 24 or -6)'}
            </span>
            <input
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              inputMode="numeric"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-500">
              Low-stock threshold
            </span>
            <input
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              inputMode="numeric"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-500">
              Reason (audit log)
            </span>
            <input
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Weekly restock from supplier"
              className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400"
            />
          </label>
        </div>

        {error && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={adjust.isPending}
            className="flex-1 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {adjust.isPending ? 'Saving…' : 'Save adjustment'}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
