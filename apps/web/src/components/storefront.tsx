'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';

import { fetchCategories, fetchProducts } from '@/lib/catalogue-api';
import { ProductCard } from './product-card';

const PAGE_SIZE = 12;

/** Catalogue browsing: category chips + search + paginated product grid. */
export function Storefront({ storeId }: { storeId: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const category = searchParams.get('category') ?? undefined;
  const q = searchParams.get('q') ?? undefined;
  const page = Number(searchParams.get('page') ?? '1');

  const [searchInput, setSearchInput] = useState(q ?? '');

  const categoriesQuery = useQuery({
    queryKey: ['categories', storeId],
    queryFn: () => fetchCategories(storeId),
  });
  const productsQuery = useQuery({
    queryKey: ['products', storeId, { category, q, page }],
    queryFn: () => fetchProducts(storeId, { category, q, page, limit: PAGE_SIZE }),
  });

  function updateFilters(next: { category?: string; q?: string; page?: number }) {
    const params = new URLSearchParams();
    const merged = { category, q, page, ...next };
    if (merged.category) params.set('category', merged.category);
    if (merged.q) params.set('q', merged.q);
    if (merged.page && merged.page > 1) params.set('page', String(merged.page));
    router.push(`/?${params.toString()}`, { scroll: false });
  }

  const meta = productsQuery.data?.meta;

  return (
    <section className="flex flex-col gap-4">
      <form
        role="search"
        onSubmit={(event) => {
          event.preventDefault();
          updateFilters({ q: searchInput.trim() || undefined, page: 1 });
        }}
      >
        <input
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search rice, Indomie, milk…"
          aria-label="Search products"
          className="w-full rounded-2xl border border-slate-300 bg-white px-4 py-3 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
        />
      </form>

      <div className="flex gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Categories">
        <CategoryChip
          label="All"
          active={!category}
          onClick={() => updateFilters({ category: undefined, page: 1 })}
        />
        {(categoriesQuery.data ?? []).map((cat) => (
          <CategoryChip
            key={cat.id}
            label={cat.name}
            active={category === cat.slug}
            onClick={() => updateFilters({ category: cat.slug, page: 1 })}
          />
        ))}
      </div>

      {productsQuery.isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="aspect-[3/4] animate-pulse rounded-2xl bg-slate-100" />
          ))}
        </div>
      ) : productsQuery.isError ? (
        <p className="rounded-xl bg-red-50 p-4 text-sm text-red-700">
          Could not load products. Please try again.
        </p>
      ) : productsQuery.data!.data.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">
          No products matched your filters.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {productsQuery.data!.data.map((product) => (
            <ProductCard key={product.id} product={product} />
          ))}
        </div>
      )}

      {meta && meta.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <button
            disabled={page <= 1}
            onClick={() => updateFilters({ page: page - 1 })}
            className="rounded-xl border border-slate-200 px-3 py-2 disabled:opacity-40"
          >
            ← Previous
          </button>
          <span className="text-slate-500">
            Page {meta.page} of {meta.totalPages} · {meta.total} items
          </span>
          <button
            disabled={page >= meta.totalPages}
            onClick={() => updateFilters({ page: page + 1 })}
            className="rounded-xl border border-slate-200 px-3 py-2 disabled:opacity-40"
          >
            Next →
          </button>
        </div>
      )}
    </section>
  );
}

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition ${
        active ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-100'
      }`}
    >
      {label}
    </button>
  );
}
