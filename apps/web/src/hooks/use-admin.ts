'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EntityStatus, OrderStatus, UserRole } from '@bokku/shared';

import * as adminApi from '@/lib/admin-api';
import { useAuthStore } from '@/stores/auth-store';

function useAdminMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  scope: string,
) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...adminKey(user?.id), scope] }),
  });
}

export function isPlatformAdmin(role: string | undefined): boolean {
  return role === 'PLATFORM_ADMIN';
}

function adminKey(userId: string | undefined) {
  return ['admin', userId ?? 'anonymous'] as const;
}

/** Platform-wide summary; polls gently so the overview stays fresh. */
export function useAdminDashboard() {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: [...adminKey(user?.id), 'dashboard'],
    queryFn: adminApi.fetchAdminDashboard,
    enabled: isPlatformAdmin(user?.role),
    refetchInterval: 15_000,
  });
}

export function useAdminUsers(
  filters: { role?: UserRole; status?: EntityStatus; q?: string },
  page = 1,
) {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: [...adminKey(user?.id), 'users', filters, page],
    queryFn: () => adminApi.fetchAdminUsers({ ...filters, page, limit: 20 }),
    enabled: isPlatformAdmin(user?.role),
  });
}

export function useUpdateAdminUserRole() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn: (input: { userId: string; role: UserRole; reason?: string }) =>
      adminApi.updateAdminUserRole(input.userId, { role: input.role, reason: input.reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...adminKey(user?.id), 'users'] }),
  });
}

export function useUpdateAdminUserStatus() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn: (input: { userId: string; status: 'ACTIVE' | 'SUSPENDED'; reason?: string }) =>
      adminApi.updateAdminUserStatus(input.userId, { status: input.status, reason: input.reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...adminKey(user?.id), 'users'] }),
  });
}

export function useAdminStores() {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: [...adminKey(user?.id), 'stores'],
    queryFn: adminApi.fetchAdminStores,
    enabled: isPlatformAdmin(user?.role),
    refetchInterval: 30_000,
  });
}

/** Store lifecycle; invalidates the stores list (dashboard/tag totals too). */
export function useUpdateAdminStoreStatus() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn: (input: { storeId: string; status: EntityStatus; reason?: string }) =>
      adminApi.updateAdminStoreStatus(input.storeId, {
        status: input.status,
        reason: input.reason,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...adminKey(user?.id), 'stores'] });
      queryClient.invalidateQueries({ queryKey: [...adminKey(user?.id), 'dashboard'] });
    },
  });
}

/** REFUND_PENDING rescue; invalidates the orders list on success. */
export function useRetryAdminRefund() {
  return useAdminMutation((orderId: string) => adminApi.retryAdminOrderRefund(orderId), 'orders');
}

export function useAdminOrders(filters: { status?: OrderStatus; storeId?: string }, page = 1) {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: [...adminKey(user?.id), 'orders', filters, page],
    queryFn: () => adminApi.fetchAdminOrders({ ...filters, page, limit: 20 }),
    enabled: isPlatformAdmin(user?.role),
    refetchInterval: 15_000,
  });
}

export function useAdminAuditLogs(action: string | undefined, page = 1) {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: [...adminKey(user?.id), 'audit-logs', action ?? '', page],
    queryFn: () => adminApi.fetchAdminAuditLogs({ action: action || undefined, page, limit: 30 }),
    enabled: isPlatformAdmin(user?.role),
  });
}
