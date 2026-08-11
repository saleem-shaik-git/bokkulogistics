'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { CART_MAX_ITEM_QUANTITY, type PublicProductDetail } from '@bokku/shared';

import { useAddToCart } from '@/hooks/use-cart';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';

/**
 * Quantity stepper + add-to-cart against the real server cart.
 * Stock limits come from the server; guests are sent to sign in first.
 */
export function PurchasePanel({ product }: { product: PublicProductDetail }) {
  const router = useRouter();
  const [quantity, setQuantity] = useState(1);
  const [justAdded, setJustAdded] = useState(false);
  const user = useAuthStore((s) => s.user);
  const addToCart = useAddToCart();
  const setCartDrawerOpen = useUiStore((s) => s.setCartDrawerOpen);

  const max = Math.max(0, Math.min(product.stockQuantity, CART_MAX_ITEM_QUANTITY));
  const canBuy = product.available && max > 0;

  const serverError =
    addToCart.error instanceof ApiError
      ? addToCart.error.message
      : addToCart.isError
        ? 'Could not add to cart'
        : null;

  function handleAdd() {
    if (!user) {
      // Guests sign in first; the login page returns them here afterwards.
      router.push(`/login?next=${encodeURIComponent(`/products/${product.id}`)}`);
      return;
    }
    addToCart.reset();
    addToCart.mutate(
      { productId: product.id, quantity },
      {
        onSuccess: () => {
          setJustAdded(true);
          setTimeout(() => setJustAdded(false), 1500);
          setCartDrawerOpen(true);
        },
      },
    );
  }

  return (
    <div className="mt-2 flex flex-col gap-2">
      <div className="flex items-center gap-3">
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
          disabled={!canBuy || addToCart.isPending}
          onClick={handleAdd}
          className="flex-1 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
        >
          {!canBuy
            ? 'Out of stock'
            : addToCart.isPending
              ? 'Adding…'
              : justAdded
                ? 'Added ✓'
                : user
                  ? 'Add to cart'
                  : 'Sign in to add'}
        </button>
      </div>

      {serverError && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
          {serverError}
        </p>
      )}
    </div>
  );
}
