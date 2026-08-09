import type { Paginated, PublicOrderDetail, PublicOrderSummary } from '@bokku/shared';

import { authedRequest } from './authed-api';

/**
 * Orders. Placing an order is idempotent server-side (the payment is the
 * uniqueness anchor), so the retry-safe result page may repeat the call.
 */
export function placeOrder(paymentReference: string): Promise<PublicOrderDetail> {
  return authedRequest<PublicOrderDetail>('/orders', { body: { paymentReference } });
}

export function fetchOrders(params: {
  page?: number;
  limit?: number;
}): Promise<Paginated<PublicOrderSummary>> {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return authedRequest<Paginated<PublicOrderSummary>>(`/orders${qs ? `?${qs}` : ''}`);
}

export function fetchOrder(id: string): Promise<PublicOrderDetail> {
  return authedRequest<PublicOrderDetail>(`/orders/${encodeURIComponent(id)}`);
}
