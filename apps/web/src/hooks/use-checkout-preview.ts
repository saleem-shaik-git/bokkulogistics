'use client';

import { useQuery } from '@tanstack/react-query';
import type { PublicCart } from '@bokku/shared';

import { fetchCheckoutPreview } from '@/lib/checkout-api';
import { ApiError } from '@/lib/api-client';
import { useAuthStore } from '@/stores/auth-store';

/**
 * Checkout preview query, keyed by the chosen address AND the cart totals —
 * any cart mutation changes subtotal/itemCount, which re-keys and refetches,
 * so the breakdown can never go stale.
 */
export function useCheckoutPreview(addressId: string | null, cart: PublicCart | undefined) {
  const user = useAuthStore((s) => s.user);
  const hasItems = !!cart?.id && cart.items.length > 0;
  return useQuery({
    queryKey: [
      'checkout-preview',
      user?.id ?? 'anonymous',
      addressId,
      cart?.subtotal ?? 0,
      cart?.itemCount ?? 0,
    ],
    queryFn: () => fetchCheckoutPreview(addressId!),
    enabled: !!user && !!addressId && hasItems,
    retry: (count, error) =>
      !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
  });
}
