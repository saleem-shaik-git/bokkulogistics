import type { PublicCart } from '@bokku/shared';

import { authedRequest } from './authed-api';

/**
 * Server cart API. Every mutating call returns the whole authoritative
 * cart, which callers feed straight back into the query cache — the
 * server always has the last word on prices, stock and totals.
 */
export function fetchCart(): Promise<PublicCart> {
  return authedRequest<PublicCart>('/cart');
}

export function addCartItem(input: { productId: string; quantity: number }): Promise<PublicCart> {
  return authedRequest<PublicCart>('/cart/items', { body: input });
}

export function updateCartItem(itemId: string, quantity: number): Promise<PublicCart> {
  return authedRequest<PublicCart>(`/cart/items/${itemId}`, {
    method: 'PATCH',
    body: { quantity },
  });
}

export function removeCartItem(itemId: string): Promise<PublicCart> {
  return authedRequest<PublicCart>(`/cart/items/${itemId}`, { method: 'DELETE' });
}

export function clearCart(): Promise<{ cleared: boolean }> {
  return authedRequest<{ cleared: boolean }>('/cart', { method: 'DELETE' });
}
