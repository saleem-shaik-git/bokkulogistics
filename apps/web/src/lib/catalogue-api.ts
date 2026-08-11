import type {
  Paginated,
  PublicCategory,
  PublicProductDetail,
  PublicProductListItem,
  PublicStore,
} from '@bokku/shared';

import { apiRequest } from './api-client';

export interface ListProductsParams {
  page?: number;
  limit?: number;
  q?: string;
  category?: string;
}

export function fetchFirstStore(): Promise<PublicStore | null> {
  return apiRequest<Paginated<PublicStore>>('/stores?limit=1').then((page) => page.data[0] ?? null);
}

export function fetchStore(id: string): Promise<PublicStore> {
  return apiRequest<PublicStore>(`/stores/${id}`);
}

export function fetchCategories(storeId: string): Promise<PublicCategory[]> {
  return apiRequest<PublicCategory[]>(`/stores/${storeId}/categories`);
}

export function fetchProducts(
  storeId: string,
  params: ListProductsParams = {},
): Promise<Paginated<PublicProductListItem>> {
  const search = new URLSearchParams();
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  if (params.q) search.set('q', params.q);
  if (params.category) search.set('category', params.category);
  const qs = search.toString();
  return apiRequest<Paginated<PublicProductListItem>>(
    `/stores/${storeId}/products${qs ? `?${qs}` : ''}`,
  );
}

export function fetchProduct(id: string): Promise<PublicProductDetail> {
  return apiRequest<PublicProductDetail>(`/products/${id}`);
}
