'use client';

import { useEffect, useState } from 'react';

import { useCart } from '@/hooks/use-cart';
import { useAuthStore } from '@/stores/auth-store';
import { useUiStore } from '@/stores/ui-store';

/** Header cart button with a live item-count badge; opens the cart drawer. */
export function CartButton() {
  // Hydration guard: the persisted session only exists on the client.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const user = useAuthStore((s) => s.user);
  const { data: cart } = useCart();
  const setCartDrawerOpen = useUiStore((s) => s.setCartDrawerOpen);

  const count = hydrated && user ? (cart?.itemCount ?? 0) : 0;

  return (
    <button
      type="button"
      onClick={() => setCartDrawerOpen(true)}
      aria-label={count > 0 ? `Open cart, ${count} item${count === 1 ? '' : 's'}` : 'Open cart'}
      className="relative rounded-xl border border-slate-200 p-2 text-slate-600 transition hover:bg-slate-100"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-5 w-5"
        aria-hidden
      >
        <circle cx="9" cy="21" r="1" />
        <circle cx="20" cy="21" r="1" />
        <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
      </svg>
      {count > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-600 px-1 text-[11px] font-bold text-white">
          {count > 99 ? '99+' : count}
        </span>
      )}
    </button>
  );
}
