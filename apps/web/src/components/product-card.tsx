import Link from 'next/link';
import type { PublicProductListItem } from '@bokku/shared';

import { formatKobo } from '@/lib/money';

export function ProductCard({ product }: { product: PublicProductListItem }) {
  const detail = `/products/${product.id}`;
  return (
    <Link
      href={detail}
      className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
    >
      <div className="relative aspect-[3/2] w-full bg-slate-100">
        <img
          src={product.imageUrl ?? `https://placehold.co/600x400/f1f5f9/64748b?text=Bokku`}
          alt={product.name}
          className="h-full w-full object-cover"
          loading="lazy"
        />
        {!product.available && (
          <span className="absolute inset-x-2 bottom-2 rounded-lg bg-slate-900/80 px-2 py-1 text-center text-xs font-medium text-white">
            Out of stock
          </span>
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        <p className="line-clamp-2 text-sm font-medium text-slate-800 group-hover:text-brand-700">
          {product.name}
        </p>
        <p className="mt-auto pt-1 text-base font-bold text-slate-900">
          {formatKobo(product.price)}
        </p>
      </div>
    </Link>
  );
}
