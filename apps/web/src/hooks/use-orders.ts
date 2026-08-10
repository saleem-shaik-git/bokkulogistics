'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DELIVERY_TERMINAL_STATUSES,
  ORDER_TERMINAL_STATUSES,
  type OrderStatus,
  type PublicDeliveryTracking,
} from '@bokku/shared';

import { ApiError } from '@/lib/api-client';
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

/** Statuses in which a courier may exist for the order. */
const PRE_DISPATCH_ORDER_STATUSES: readonly OrderStatus[] = [
  'PENDING_PAYMENT',
  'PAID',
  'CONFIRMED',
  'PREPARING',
];

/**
 * Courier tracking for an order. 404 DELIVERY_NOT_FOUND maps to null (not
 * an error — nothing dispatched yet); polls while the courier is active.
 */
export function useOrderTracking(
  orderId: string | undefined,
  orderStatus: OrderStatus | undefined,
) {
  const user = useAuthStore((s) => s.user);
  const mayHaveCourier =
    orderStatus !== undefined && !PRE_DISPATCH_ORDER_STATUSES.includes(orderStatus);
  return useQuery({
    queryKey: [...orderQueryKey(user?.id, orderId), 'tracking'],
    queryFn: async (): Promise<PublicDeliveryTracking | null> => {
      try {
        return await ordersApi.fetchOrderTracking(orderId!);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    enabled: !!user && !!orderId && mayHaveCourier,
    refetchInterval: (q) =>
      q.state.data && !DELIVERY_TERMINAL_STATUSES.includes(q.state.data.status) ? 4_000 : false,
  });
}
