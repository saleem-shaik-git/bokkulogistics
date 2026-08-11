'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  DELIVERY_TERMINAL_STATUSES,
  type OrderStatus,
  type PublicDeliveryTracking,
} from '@bokku/shared';

import { ApiError } from '@/lib/api-client';
import * as bokkuApi from '@/lib/bokku-api';
import { useAuthStore } from '@/stores/auth-store';

export const STAFF_ROLES = ['STORE_MANAGER', 'BOKKU_ADMIN', 'PLATFORM_ADMIN'] as const;

export function isStaffRole(role: string | undefined): boolean {
  return !!role && (STAFF_ROLES as readonly string[]).includes(role);
}

function bokkuKey(userId: string | undefined) {
  return ['bokku', userId ?? 'anonymous'] as const;
}

/** Store overview; polls gently so staff see fresh numbers. */
export function useBokkuDashboard() {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: [...bokkuKey(user?.id), 'dashboard'],
    queryFn: bokkuApi.fetchDashboard,
    enabled: isStaffRole(user?.role),
    refetchInterval: 15_000,
  });
}

export function useBokkuOrders(status?: OrderStatus, page = 1) {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: [...bokkuKey(user?.id), 'orders', status ?? 'ALL', page],
    queryFn: () => bokkuApi.fetchOpsOrders({ status, page, limit: 20 }),
    enabled: isStaffRole(user?.role),
    refetchInterval: 8_000,
  });
}

export function useBokkuOrder(orderId: string | undefined) {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: [...bokkuKey(user?.id), 'orders', 'detail', orderId],
    queryFn: () => bokkuApi.fetchOpsOrder(orderId!),
    enabled: isStaffRole(user?.role) && !!orderId,
    refetchInterval: (q) =>
      q.state.data && !['DELIVERED', 'CANCELLED', 'REFUNDED'].includes(q.state.data.status)
        ? 8_000
        : false,
  });
}

export function useTransitionBokkuOrder() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn: (input: { orderId: string; status: OrderStatus; reason?: string }) =>
      bokkuApi.transitionOpsOrder(input.orderId, { status: input.status, reason: input.reason }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...bokkuKey(user?.id), 'orders'] }),
  });
}

/** Order statuses in which no courier can exist yet. */
const PRE_DISPATCH_ORDER_STATUSES: readonly OrderStatus[] = [
  'PENDING_PAYMENT',
  'PAID',
  'CONFIRMED',
  'PREPARING',
];

/**
 * Courier tracking for a store order. 404 DELIVERY_NOT_FOUND maps to null
 * (nothing dispatched yet — e.g. dispatch hiccup on a READY order); polls
 * while the courier is active.
 */
export function useOpsOrderTracking(
  orderId: string | undefined,
  orderStatus: OrderStatus | undefined,
) {
  const user = useAuthStore((s) => s.user);
  const mayHaveCourier =
    orderStatus !== undefined && !PRE_DISPATCH_ORDER_STATUSES.includes(orderStatus);
  return useQuery({
    queryKey: [...bokkuKey(user?.id), 'orders', 'detail', orderId, 'tracking'],
    queryFn: async (): Promise<PublicDeliveryTracking | null> => {
      try {
        return await bokkuApi.fetchOpsOrderTracking(orderId!);
      } catch (error) {
        if (error instanceof ApiError && error.status === 404) return null;
        throw error;
      }
    },
    enabled: isStaffRole(user?.role) && !!orderId && mayHaveCourier,
    refetchInterval: (q) =>
      q.state.data && !DELIVERY_TERMINAL_STATUSES.includes(q.state.data.status) ? 4_000 : false,
  });
}

/** Explicit dispatch retry; invalidates the order detail + tracking. */
export function useDispatchBokkuOrder() {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn: (orderId: string) => bokkuApi.dispatchOpsOrder(orderId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...bokkuKey(user?.id), 'orders'] }),
  });
}

export function useBokkuProducts(page = 1) {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: [...bokkuKey(user?.id), 'products', page],
    queryFn: () => bokkuApi.fetchOpsProducts({ page, limit: 50 }),
    enabled: isStaffRole(user?.role),
  });
}

export function useBokkuInventory() {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: [...bokkuKey(user?.id), 'inventory'],
    queryFn: bokkuApi.fetchOpsInventory,
    enabled: isStaffRole(user?.role),
    refetchInterval: 15_000,
  });
}

function useBokkuMutation<TInput, TResult>(
  mutationFn: (input: TInput) => Promise<TResult>,
  scope: 'products' | 'inventory',
) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [...bokkuKey(user?.id), scope] }),
  });
}

export function useCreateBokkuProduct() {
  return useBokkuMutation(
    (input: bokkuApi.OpsCreateProductInput) => bokkuApi.createOpsProduct(input),
    'products',
  );
}

export function useUpdateBokkuProduct() {
  return useBokkuMutation(
    (input: { id: string } & bokkuApi.OpsUpdateProductInput) =>
      bokkuApi.updateOpsProduct(input.id, input),
    'products',
  );
}

export function useAdjustBokkuInventory() {
  return useBokkuMutation(
    (input: { productId: string } & bokkuApi.OpsAdjustInventoryInput) =>
      bokkuApi.adjustOpsInventory(input.productId, input),
    'inventory',
  );
}

/** Staff workflow helpers mirrored from the server-side state policy. */
export const OPS_NEXT_STEP: Partial<Record<OrderStatus, { to: OrderStatus; label: string }>> = {
  PAID: { to: 'CONFIRMED', label: 'Confirm order' },
  CONFIRMED: { to: 'PREPARING', label: 'Start preparing' },
  PREPARING: { to: 'READY_FOR_PICKUP', label: 'Ready for pickup' },
};

/**
 * Staff-cancellable order statuses. DELIVERY_REQUESTED / DRIVER_ASSIGNED
 * cancel the courier through the delivery provider first (server aborts with
 * 409 DELIVERY_NOT_CANCELLABLE once the rider has the parcel).
 */
export const OPS_CANCELLABLE: readonly OrderStatus[] = [
  'PAID',
  'CONFIRMED',
  'PREPARING',
  'DELIVERY_REQUESTED',
  'DRIVER_ASSIGNED',
];
