'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { EMPTY_CART, type PublicCart } from '@bokku/shared';

import * as cartApi from '@/lib/cart-api';
import { useAuthStore } from '@/stores/auth-store';

/** Keyed per user so a session change never shows someone else's cart. */
export function cartQueryKey(userId: string | undefined) {
  return ['cart', userId ?? 'anonymous'] as const;
}

/** Live server cart for the signed-in user (disabled while anonymous). */
export function useCart() {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: cartQueryKey(user?.id),
    queryFn: cartApi.fetchCart,
    enabled: !!user,
  });
}

/**
 * Mutations return the whole server-authoritative cart; we adopt it into
 * the cache directly — no optimistic client-side price math, ever.
 */
function useCartMutation<TInput>(mutationFn: (input: TInput) => Promise<PublicCart>) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn,
    onSuccess: (cart) => queryClient.setQueryData(cartQueryKey(user?.id), cart),
  });
}

export function useAddToCart() {
  return useCartMutation(cartApi.addCartItem);
}

export function useUpdateCartItem() {
  return useCartMutation((input: { itemId: string; quantity: number }) =>
    cartApi.updateCartItem(input.itemId, input.quantity),
  );
}

export function useRemoveCartItem() {
  return useCartMutation((itemId: string) => cartApi.removeCartItem(itemId));
}

export function useClearCart() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn: cartApi.clearCart,
    onSuccess: () => queryClient.setQueryData(cartQueryKey(user?.id), EMPTY_CART),
  });
}
