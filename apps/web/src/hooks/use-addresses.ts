'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddressInput } from '@bokku/validation';

import * as addressesApi from '@/lib/addresses-api';
import { useAuthStore } from '@/stores/auth-store';

export function addressesQueryKey(userId: string | undefined) {
  return ['addresses', userId ?? 'anonymous'] as const;
}

/** The signed-in user's saved addresses (default first). */
export function useAddresses() {
  const user = useAuthStore((s) => s.user);
  return useQuery({
    queryKey: addressesQueryKey(user?.id),
    queryFn: addressesApi.fetchAddresses,
    enabled: !!user,
  });
}

function useAddressMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const queryClient = useQueryClient();
  const user = useAuthStore((s) => s.user);
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: addressesQueryKey(user?.id) }),
  });
}

export function useCreateAddress() {
  return useAddressMutation((input: AddressInput) => addressesApi.createAddress(input));
}

export function useSetDefaultAddress() {
  return useAddressMutation((id: string) => addressesApi.updateAddress(id, { isDefault: true }));
}

export function useDeleteAddress() {
  return useAddressMutation((id: string) => addressesApi.deleteAddress(id));
}
