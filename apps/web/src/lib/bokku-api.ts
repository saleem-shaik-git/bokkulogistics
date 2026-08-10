import type {
  OpsDashboardSummary,
  OpsInventoryRow,
  OpsProduct,
  OpsProductStatus,
  OrderStatus,
  Paginated,
  PublicOrderDetail,
  PublicOrderSummary,
} from '@bokku/shared';

import { authedRequest } from './authed-api';

/**
 * Bokku operations API (store staff). The server enforces role + store_staff
 * membership on every call; these are thin typed wrappers.
 */

export function fetchDashboard(): Promise<OpsDashboardSummary> {
  return authedRequest<OpsDashboardSummary>('/bokku/dashboard');
}

export function fetchOpsOrders(params: {
  status?: OrderStatus;
  page?: number;
  limit?: number;
}): Promise<Paginated<PublicOrderSummary>> {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return authedRequest<Paginated<PublicOrderSummary>>(`/bokku/orders${qs ? `?${qs}` : ''}`);
}

export function fetchOpsOrder(id: string): Promise<PublicOrderDetail> {
  return authedRequest<PublicOrderDetail>(`/bokku/orders/${encodeURIComponent(id)}`);
}

export function transitionOpsOrder(
  id: string,
  input: { status: OrderStatus; reason?: string },
): Promise<PublicOrderDetail> {
  return authedRequest<PublicOrderDetail>(`/bokku/orders/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: input,
  });
}

export function fetchOpsProducts(params: {
  page?: number;
  limit?: number;
}): Promise<Paginated<OpsProduct>> {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return authedRequest<Paginated<OpsProduct>>(`/bokku/products${qs ? `?${qs}` : ''}`);
}

export interface OpsCreateProductInput {
  name: string;
  categoryId: string;
  description?: string;
  price: number;
  sku?: string;
  imageUrl?: string;
  initialStock?: number;
  lowStockThreshold?: number;
  status?: OpsProductStatus;
}

export type OpsUpdateProductInput = Partial<Omit<OpsCreateProductInput, 'initialStock' | 'sku'>>;

export function createOpsProduct(input: OpsCreateProductInput): Promise<OpsProduct> {
  return authedRequest<OpsProduct>('/bokku/products', { body: input });
}

export function updateOpsProduct(id: string, input: OpsUpdateProductInput): Promise<OpsProduct> {
  return authedRequest<OpsProduct>(`/bokku/products/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: input,
  });
}

export function fetchOpsInventory(): Promise<OpsInventoryRow[]> {
  return authedRequest<OpsInventoryRow[]>('/bokku/inventory');
}

export interface OpsAdjustInventoryInput {
  adjustment?: number;
  setQuantity?: number;
  lowStockThreshold?: number;
  reason: string;
}

export function adjustOpsInventory(
  productId: string,
  input: OpsAdjustInventoryInput,
): Promise<OpsInventoryRow> {
  return authedRequest<OpsInventoryRow>(`/bokku/inventory/${encodeURIComponent(productId)}`, {
    method: 'PATCH',
    body: input,
  });
}
