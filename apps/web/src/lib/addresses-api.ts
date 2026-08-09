import type { PublicAddress } from '@bokku/shared';
import type { AddressInput } from '@bokku/validation';

import { authedRequest } from './authed-api';

/** Saved delivery addresses (owner-scoped on the server). */
export function fetchAddresses(): Promise<PublicAddress[]> {
  return authedRequest<PublicAddress[]>('/addresses');
}

export function createAddress(input: AddressInput): Promise<PublicAddress> {
  return authedRequest<PublicAddress>('/addresses', { body: input });
}

export function updateAddress(id: string, input: Partial<AddressInput>): Promise<PublicAddress> {
  return authedRequest<PublicAddress>(`/addresses/${id}`, { method: 'PATCH', body: input });
}

export function deleteAddress(id: string): Promise<{ deleted: boolean }> {
  return authedRequest<{ deleted: boolean }>(`/addresses/${id}`, { method: 'DELETE' });
}
