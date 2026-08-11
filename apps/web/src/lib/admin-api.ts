import type {
  AdminAuditLog,
  AdminDashboardSummary,
  AdminStoreRow,
  EntityStatus,
  OrderStatus,
  Paginated,
  PublicOrderDetail,
  PublicOrderSummary,
  PublicUser,
  UserRole,
} from '@bokku/shared';

import { authedRequest } from './authed-api';

/**
 * Platform admin API (PLATFORM_ADMIN). The server enforces the role on
 * every call; these are thin typed wrappers over the same envelope as
 * the rest of the app.
 */

export function fetchAdminDashboard(): Promise<AdminDashboardSummary> {
  return authedRequest<AdminDashboardSummary>('/admin/dashboard');
}

export function fetchAdminUsers(params: {
  role?: UserRole;
  status?: EntityStatus;
  q?: string;
  page?: number;
  limit?: number;
}): Promise<Paginated<PublicUser>> {
  const search = new URLSearchParams();
  if (params.role) search.set('role', params.role);
  if (params.status) search.set('status', params.status);
  if (params.q) search.set('q', params.q);
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return authedRequest<Paginated<PublicUser>>(`/admin/users${qs ? `?${qs}` : ''}`);
}

export function updateAdminUserRole(
  id: string,
  input: { role: UserRole; reason?: string },
): Promise<PublicUser> {
  return authedRequest<PublicUser>(`/admin/users/${encodeURIComponent(id)}/role`, {
    method: 'PATCH',
    body: input,
  });
}

export function updateAdminUserStatus(
  id: string,
  input: { status: 'ACTIVE' | 'SUSPENDED'; reason?: string },
): Promise<PublicUser> {
  return authedRequest<PublicUser>(`/admin/users/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: input,
  });
}

export function fetchAdminStores(): Promise<AdminStoreRow[]> {
  return authedRequest<AdminStoreRow[]>('/admin/stores');
}

/** Lifecycle lever — a non-ACTIVE store refuses new business at checkout. */
export function updateAdminStoreStatus(
  id: string,
  input: { status: EntityStatus; reason?: string },
): Promise<AdminStoreRow> {
  return authedRequest<AdminStoreRow>(`/admin/stores/${encodeURIComponent(id)}/status`, {
    method: 'PATCH',
    body: input,
  });
}

/** Retry the provider refund for a REFUND_PENDING order (idempotent). */
export function retryAdminOrderRefund(id: string): Promise<PublicOrderDetail> {
  return authedRequest<PublicOrderDetail>(`/admin/orders/${encodeURIComponent(id)}/retry-refund`, {
    method: 'POST',
  });
}

export function fetchAdminOrders(params: {
  status?: OrderStatus;
  storeId?: string;
  page?: number;
  limit?: number;
}): Promise<Paginated<PublicOrderSummary>> {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.storeId) search.set('storeId', params.storeId);
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return authedRequest<Paginated<PublicOrderSummary>>(`/admin/orders${qs ? `?${qs}` : ''}`);
}

export function fetchAdminOrder(id: string): Promise<PublicOrderDetail> {
  return authedRequest<PublicOrderDetail>(`/admin/orders/${encodeURIComponent(id)}`);
}

export function fetchAdminAuditLogs(params: {
  action?: string;
  page?: number;
  limit?: number;
}): Promise<Paginated<AdminAuditLog>> {
  const search = new URLSearchParams();
  if (params.action) search.set('action', params.action);
  if (params.page) search.set('page', String(params.page));
  if (params.limit) search.set('limit', String(params.limit));
  const qs = search.toString();
  return authedRequest<Paginated<AdminAuditLog>>(`/admin/audit-logs${qs ? `?${qs}` : ''}`);
}
