'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { OpsProduct, OpsProductStatus, PublicCategory } from '@bokku/shared';

import {
  useBokkuDashboard,
  useBokkuProducts,
  useCreateBokkuProduct,
  useUpdateBokkuProduct,
} from '@/hooks/use-bokku';
import { ApiError } from '@/lib/api-client';
import { fetchCategories } from '@/lib/catalogue-api';
import { formatKobo } from '@/lib/money';

const STATUS_TONES: Record<OpsProductStatus, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700',
  INACTIVE: 'bg-slate-100 text-slate-500',
  OUT_OF_STOCK: 'bg-red-100 text-red-600',
  DRAFT: 'bg-amber-100 text-amber-700',
};

const STATUS_LABELS: Record<OpsProductStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  OUT_OF_STOCK: 'Out of stock',
  DRAFT: 'Draft',
};

/**
 * Catalogue management for the store: list, create, edit. Prices are shown
 * and entered in Naira, converted to integer kobo at the API boundary.
 */
export default function BokkuProductsPage() {
  const productsQuery = useBokkuProducts();
  const dashboardQuery = useBokkuDashboard(); // store.id for the category list
  const storeId = dashboardQuery.data?.store.id;

  const categoriesQuery = useQuery({
    queryKey: ['catalogue', storeId, 'categories'],
    queryFn: () => fetchCategories(storeId!),
    enabled: !!storeId,
  });

  const [editing, setEditing] = useState<OpsProduct | 'new' | null>(null);
  const products = productsQuery.data?.data ?? [];
  const meta = productsQuery.data?.meta;
  const categories = categoriesQuery.data ?? [];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Products</h1>
        <button
          type="button"
          onClick={() => setEditing('new')}
          className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700"
        >
          + Add product
        </button>
      </div>

      {productsQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-xl bg-slate-100" />
          ))}
        </div>
      ) : productsQuery.isError ? (
        <p className="rounded-xl border border-red-200 bg-red-50 p-4 text-center text-sm font-medium text-red-700">
          Couldn&apos;t load products.
        </p>
      ) : products.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-8 text-center text-sm text-slate-400">
          No products yet — add the first one.
        </p>
      ) : (
        <>
          <ul className="space-y-2">
            {products.map((product) => (
              <li
                key={product.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-900">{product.name}</p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    {product.sku} · {formatKobo(product.price)} · threshold {product.lowStockThreshold}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${STATUS_TONES[product.status]}`}
                  >
                    {STATUS_LABELS[product.status]}
                  </span>
                  <button
                    type="button"
                    onClick={() => setEditing(product)}
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Edit
                  </button>
                </div>
              </li>
            ))}
          </ul>
          {meta && (
            <p className="text-center text-xs text-slate-400">
              {meta.total} products{meta.totalPages > 1 ? ` · page ${meta.page} of ${meta.totalPages}` : ''}
            </p>
          )}
        </>
      )}

      {editing && (
        <ProductForm
          product={editing === 'new' ? null : editing}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

interface FormState {
  name: string;
  categoryId: string;
  description: string;
  priceNaira: string;
  sku: string;
  imageUrl: string;
  initialStock: string;
  lowStockThreshold: string;
  status: OpsProductStatus;
}

function koboFromNaira(naira: string): number | null {
  const value = Number(naira);
  if (!Number.isFinite(value) || value < 0) return null;
  return Math.round(value * 100);
}

function ProductForm({
  product,
  categories,
  onClose,
}: {
  product: OpsProduct | null;
  categories: PublicCategory[];
  onClose: () => void;
}) {
  const createMutation = useCreateBokkuProduct();
  const updateMutation = useUpdateBokkuProduct();
  const isEdit = !!product;

  const [form, setForm] = useState<FormState>(() => ({
    name: product?.name ?? '',
    categoryId: product?.categoryId ?? categories[0]?.id ?? '',
    description: product?.description ?? '',
    priceNaira: product ? (product.price / 100).toString() : '',
    sku: product?.sku ?? '',
    imageUrl: product?.imageUrl ?? '',
    initialStock: '0',
    lowStockThreshold: String(product?.lowStockThreshold ?? 5),
    status: product?.status ?? 'ACTIVE',
  }));
  const [formError, setFormError] = useState<string | null>(null);
  useEffect(() => {
    // Categories may arrive after the form opened; default sensibly.
    setForm((f) => (f.categoryId || !categories[0] ? f : { ...f, categoryId: categories[0].id }));
  }, [categories]);

  const busy = createMutation.isPending || updateMutation.isPending;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function submit() {
    setFormError(null);
    const price = koboFromNaira(form.priceNaira);
    if (form.name.trim().length < 2) return setFormError('Give the product a name.');
    if (!form.categoryId) return setFormError('Pick a category.');
    if (price === null) return setFormError('Enter a valid price in Naira.');
    const threshold = Number(form.lowStockThreshold);
    if (!Number.isInteger(threshold) || threshold < 0)
      return setFormError('Low-stock threshold must be a whole number ≥ 0.');

    const onError = (err: unknown) =>
      setFormError(err instanceof ApiError ? err.message : 'Saving failed — try again.');
    const onSuccess = () => onClose();

    if (isEdit && product) {
      updateMutation.mutate(
        {
          id: product.id,
          name: form.name.trim(),
          categoryId: form.categoryId,
          description: form.description.trim() || undefined,
          price,
          imageUrl: form.imageUrl.trim() || undefined,
          lowStockThreshold: threshold,
          status: form.status,
        },
        { onSuccess, onError },
      );
      return;
    }

    const initialStock = Number(form.initialStock);
    if (!Number.isInteger(initialStock) || initialStock < 0)
      return setFormError('Initial stock must be a whole number ≥ 0.');
    createMutation.mutate(
      {
        name: form.name.trim(),
        categoryId: form.categoryId,
        description: form.description.trim() || undefined,
        price,
        sku: form.sku.trim() || undefined,
        imageUrl: form.imageUrl.trim() || undefined,
        initialStock,
        lowStockThreshold: threshold,
        status: form.status,
      },
      { onSuccess, onError },
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={isEdit ? `Edit ${product.name}` : 'Add product'}
        className="max-h-[90dvh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5"
      >
        <h2 className="text-lg font-bold">{isEdit ? `Edit ${product.name}` : 'Add product'}</h2>

        <div className="mt-4 space-y-3">
          <Field label="Name">
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              className={inputClass}
              placeholder="Indomie Chicken 70g"
            />
          </Field>
          <Field label="Category">
            <select
              value={form.categoryId}
              onChange={(e) => set('categoryId', e.target.value)}
              className={inputClass}
            >
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Price (₦)">
            <input
              value={form.priceNaira}
              onChange={(e) => set('priceNaira', e.target.value)}
              className={inputClass}
              inputMode="decimal"
              placeholder="350.00"
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            {!isEdit && (
              <Field label="Initial stock">
                <input
                  value={form.initialStock}
                  onChange={(e) => set('initialStock', e.target.value)}
                  className={inputClass}
                  inputMode="numeric"
                />
              </Field>
            )}
            <Field label="Low-stock threshold">
              <input
                value={form.lowStockThreshold}
                onChange={(e) => set('lowStockThreshold', e.target.value)}
                className={inputClass}
                inputMode="numeric"
              />
            </Field>
            <Field label="Status">
              <select
                value={form.status}
                onChange={(e) => set('status', e.target.value as OpsProductStatus)}
                className={inputClass}
              >
                {(Object.keys(STATUS_LABELS) as OpsProductStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          {!isEdit && (
            <Field label="SKU (optional — auto-generated)">
              <input
                value={form.sku}
                onChange={(e) => set('sku', e.target.value)}
                className={inputClass}
                placeholder="BOK-GRC-010"
              />
            </Field>
          )}
          <Field label="Image URL (optional)">
            <input
              value={form.imageUrl}
              onChange={(e) => set('imageUrl', e.target.value)}
              className={inputClass}
              placeholder="https://…"
            />
          </Field>
          <Field label="Description (optional)">
            <textarea
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              rows={2}
              className={inputClass}
            />
          </Field>
        </div>

        {formError && (
          <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {formError}
          </p>
        )}

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="flex-1 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? 'Saving…' : isEdit ? 'Save changes' : 'Create product'}
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

const inputClass =
  'w-full rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-brand-400';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-500">{label}</span>
      {children}
    </label>
  );
}
