'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { PublicCartLine } from '@bokku/shared';

import { useCart, useClearCart, useRemoveCartItem, useUpdateCartItem } from '@/hooks/use-cart';
import { ApiError } from '@/lib/api-client';
import { formatKobo } from '@/lib/money';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';

/**
 * Slide-over cart panel (bottom-sheet feel on mobile). Every number shown
 * comes from the server cart; steppers round-trip through the API.
 */
export function CartDrawer() {
  const open = useUiStore((s) => s.cartDrawerOpen);
  const setOpen = useUiStore((s) => s.setCartDrawerOpen);

  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  // Lock body scroll while the drawer is open.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const user = useAuthStore((s) => s.user);
  const cartQuery = useCart();
  const updateItem = useUpdateCartItem();
  const removeItem = useRemoveCartItem();
  const clearCart = useClearCart();

  if (!hydrated || !open) return null;

  const cart = cartQuery.data;
  const busy = updateItem.isPending || removeItem.isPending || clearCart.isPending;
  const mutationError = [updateItem.error, removeItem.error, clearCart.error]
    .filter((e): e is Error => e instanceof Error)
    .map((e) => (e instanceof ApiError ? e.message : 'Something went wrong'))[0];
  const unavailableCount = cart?.items.filter((line) => !line.available).length ?? 0;

  return (
    <div role="dialog" aria-modal="true" aria-label="Shopping cart" className="fixed inset-0 z-50">
      <button
        aria-label="Close cart"
        className="absolute inset-0 bg-slate-900/50"
        onClick={() => setOpen(false)}
      />

      <aside className="absolute inset-y-0 right-0 flex w-full max-w-md flex-col bg-white shadow-2xl">
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-lg font-bold">Your cart</h2>
          <button
            onClick={() => setOpen(false)}
            aria-label="Close cart"
            className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"
          >
            ✕
          </button>
        </header>

        {!user ? (
          <EmptyPanel
            title="Sign in to use your cart"
            body="Your cart is stored on the server so it follows you across devices."
          >
            <Link
              href="/login"
              onClick={() => setOpen(false)}
              className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Sign in
            </Link>
          </EmptyPanel>
        ) : cartQuery.isLoading ? (
          <div className="flex-1 space-y-3 p-5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-100" />
            ))}
          </div>
        ) : cartQuery.isError || !cart ? (
          <EmptyPanel
            title="Cart unavailable"
            body="We could not load your cart. Please close and try again."
          />
        ) : cart.items.length === 0 ? (
          <EmptyPanel title="Your cart is empty" body="Browse the shop and add something you like.">
            <button
              onClick={() => setOpen(false)}
              className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700"
            >
              Continue shopping
            </button>
          </EmptyPanel>
        ) : (
          <>
            <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
              {unavailableCount > 0 && (
                <p role="alert" className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  {unavailableCount === 1
                    ? 'One item became unavailable'
                    : `${unavailableCount} items became unavailable`}{' '}
                  — adjust quantities before checkout.
                </p>
              )}
              {mutationError && (
                <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700">
                  {mutationError}
                </p>
              )}
              {cart.items.map((line) => (
                <CartLineRow
                  key={line.id}
                  line={line}
                  disabled={busy}
                  onSetQuantity={(quantity) => updateItem.mutate({ itemId: line.id, quantity })}
                  onRemove={() => removeItem.mutate(line.id)}
                />
              ))}
            </div>

            <footer className="space-y-3 border-t border-slate-100 px-5 py-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">
                  Subtotal · {cart.itemCount} item{cart.itemCount === 1 ? '' : 's'}
                </span>
                <span className="text-lg font-bold">{formatKobo(cart.subtotal)}</span>
              </div>
              <p className="text-xs text-slate-400">
                Delivery and fees are calculated at checkout.
              </p>
              <button
                type="button"
                disabled
                title="Checkout arrives with Phase 5"
                className="w-full cursor-not-allowed rounded-xl bg-slate-200 px-4 py-3 text-sm font-semibold text-slate-400"
              >
                Checkout · coming soon
              </button>
              <button
                type="button"
                onClick={() => clearCart.mutate()}
                disabled={busy}
                className="w-full rounded-xl px-4 py-2 text-xs font-medium text-slate-400 hover:text-red-600 disabled:opacity-50"
              >
                Clear cart
              </button>
            </footer>
          </>
        )}
      </aside>
    </div>
  );
}

function CartLineRow({
  line,
  disabled,
  onSetQuantity,
  onRemove,
}: {
  line: PublicCartLine;
  disabled: boolean;
  onSetQuantity: (quantity: number) => void;
  onRemove: () => void;
}) {
  const max = Math.min(line.stockQuantity, 99);
  return (
    <div
      className={`flex gap-3 rounded-2xl border p-3 ${
        line.available ? 'border-slate-100' : 'border-amber-200 bg-amber-50/40'
      }`}
    >
      <img
        src={line.imageUrl ?? 'https://placehold.co/160x160/f1f5f9/64748b?text=Bokku'}
        alt=""
        className="h-16 w-16 rounded-xl object-cover"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <p className="line-clamp-2 text-sm font-medium text-slate-800">{line.name}</p>
          <p className="shrink-0 text-sm font-bold">{formatKobo(line.lineTotal)}</p>
        </div>
        {!line.available && (
          <p className="text-xs font-medium text-amber-700">
            {line.stockQuantity <= 0 ? 'Out of stock' : `Only ${line.stockQuantity} left`}
          </p>
        )}
        <div className="mt-auto flex items-center justify-between">
          <div className="flex items-center rounded-lg border border-slate-200">
            <button
              type="button"
              aria-label={`Decrease quantity of ${line.name}`}
              disabled={disabled || line.quantity <= 1}
              onClick={() => onSetQuantity(line.quantity - 1)}
              className="px-2.5 py-1 text-sm disabled:opacity-30"
            >
              −
            </button>
            <span aria-live="polite" className="min-w-7 text-center text-xs font-semibold">
              {line.quantity}
            </span>
            <button
              type="button"
              aria-label={`Increase quantity of ${line.name}`}
              disabled={disabled || line.quantity >= max}
              onClick={() => onSetQuantity(line.quantity + 1)}
              className="px-2.5 py-1 text-sm disabled:opacity-30"
            >
              +
            </button>
          </div>
          <button
            type="button"
            onClick={onRemove}
            disabled={disabled}
            className="text-xs font-medium text-slate-400 hover:text-red-600 disabled:opacity-50"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyPanel({
  title,
  body,
  children,
}: {
  title: string;
  body: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 text-center">
      <p className="text-base font-semibold text-slate-700">{title}</p>
      <p className="text-sm text-slate-400">{body}</p>
      {children && <div className="pt-2">{children}</div>}
    </div>
  );
}
