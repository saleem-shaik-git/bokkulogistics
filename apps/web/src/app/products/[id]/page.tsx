import Link from 'next/link';
import { notFound } from 'next/navigation';

import { PurchasePanel } from '@/components/purchase-panel';
import { fetchProduct } from '@/lib/catalogue-api';
import { formatKobo } from '@/lib/money';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ProductPage({ params }: Props) {
  const { id } = await params;
  const product = await fetchProduct(id).catch(() => null);
  if (!product) notFound();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 py-8 sm:max-w-2xl">
      <nav className="text-sm text-slate-500">
        <Link href="/" className="font-medium text-brand-600 hover:underline">
          ← Back to shop
        </Link>
      </nav>

      <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="relative aspect-[3/2] w-full bg-slate-100">
          <img
            src={
              product.images[0]?.url ??
              product.imageUrl ??
              `https://placehold.co/600x400/f1f5f9/64748b?text=Bokku`
            }
            alt={product.name}
            className="h-full w-full object-cover"
          />
        </div>
        <div className="flex flex-col gap-3 p-5">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {product.categoryName}
            </p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight">{product.name}</h1>
          </div>

          {product.description && <p className="text-sm text-slate-600">{product.description}</p>}

          <div className="flex items-center justify-between">
            <p className="text-2xl font-bold text-slate-900">{formatKobo(product.price)}</p>
            {product.available ? (
              <span className="rounded-full bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
                In stock{product.stockQuantity > 0 ? ` · ${product.stockQuantity}` : ''}
              </span>
            ) : (
              <span className="rounded-full bg-red-50 px-3 py-1 text-xs font-medium text-red-700">
                Out of stock
              </span>
            )}
          </div>

          <PurchasePanel product={product} />
        </div>
      </div>

      <p className="text-xs text-slate-400">SKU {product.sku}</p>
    </main>
  );
}
