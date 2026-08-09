'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ORDER_TERMINAL_STATUSES } from '@bokku/shared';

import * as ordersApi from '@/lib/orders-api';
import { useAuthStore } from '@/stores/auth-store';

export function ordersQueryKey(userId: string | undefined) {
  return ['orders', userId ?? 'anonymous'] as const;
}

export function orderQueryKey(userId: string | undefined, orderId: string | undefined) {
  return ['orders', userId ?? 'anonymous', orderId] as const;
}

/**
 * Place the order for a settled payment. Server-side idempotent — calling
 * it again with the same reference returns the same order — so callers may
 * fire it on page load without dedup worries.
 */
export function usePlaceOrder() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn: (paymentReference: string) => ordersApi.placeOrder(paymentReference),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ordersQueryKey(user?.id) }),
  });
}

/** My orders, newest first; polls while anything is still in flight. */
export function useOrders(page = 1) {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: [...ordersQueryKey(user?.id), 'list', page],
    queryFn: () => ordersApi.fetchOrders({ page, limit: 10 }),
    enabled: !!user,
    refetchInterval: (q) =>
      (q.state.data?.data ?? []).some((order) => !ORDER_TERMINAL_STATUSES.includes(order.status))
        ? 10_000
        : false,
  });
}

/** One order; polls until it reaches a terminal state (live tracking). */
export function useOrder(orderId: string | undefined) {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: orderQueryKey(user?.id, orderId),
    queryFn: () => ordersApi.fetchOrder(orderId!),
    enabled: !!user && !!orderId,
    refetchInterval: (q) =>
      q.state.data && !ORDER_TERMINAL_STATUSES.includes(q.state.data.status) ? 5_000 : false,
  });
}
