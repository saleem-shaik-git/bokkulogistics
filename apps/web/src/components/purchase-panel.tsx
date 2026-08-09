'use client';

import { useState } from 'react';
import type { PublicProductDetail } from '@bokku/shared';

import { useUiStore } from '@/stores/ui-store';

/** Quantity stepper + add-to-cart (local cart until the server Cart API lands in Phase 4). */
export function PurchasePanel({ product }: { product: PublicProductDetail }) {
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  const addToCart = useUiStore((s) => s.addToCart);

  const max = Math.max(0, Math.min(product.stockQuantity, 20));
  const canBuy = product.available && max > 0;

  return (
    <div className="mt-2 flex items-center gap-3">
      <div className="flex items-center rounded-xl border border-slate-300">
        <button
          type="button"
          aria-label="Decrease quantity"
          disabled={!canBuy || quantity <= 1}
          onClick={() => setQuantity((q) => Math.max(1, q - 1))}
          className="px-3 py-2 text-lg disabled:opacity-30"
        >
          −
        </button>
        <span aria-live="polite" className="min-w-8 text-center text-sm font-semibold">
          {quantity}
        </span>
        <button
          type="button"
          aria-label="Increase quantity"
          disabled={!canBuy || quantity >= max}
          onClick={() => setQuantity((q) => Math.min(max, q + 1))}
          className="px-3 py-2 text-lg disabled:opacity-30"
        >
          +
        </button>
      </div>

      <button
        type="button"
        disabled={!canBuy}
        onClick={() => {
          addToCart(
            {
              productId: product.id,
              name: product.name,
              price: product.price,
              imageUrl: product.imageUrl,
            },
            quantity,
          );
          setAdded(true);
          setTimeout(() => setAdded(false), 1500);
        }}
        className="flex-1 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
      >
        {!canBuy ? 'Out of stock' : added ? 'Added ✓' : 'Add to cart'}
      </button>
    </div>
  );
}
