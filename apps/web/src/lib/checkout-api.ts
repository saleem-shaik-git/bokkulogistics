import type { CheckoutPreview } from '@bokku/shared';

import { authedRequest } from './authed-api';

/**
 * Server-computed checkout preview. Read-only — safe to refetch whenever
 * the cart or the chosen address changes.
 */
export function fetchCheckoutPreview(addressId: string): Promise<CheckoutPreview> {
  return authedRequest<CheckoutPreview>('/checkout/preview', { body: { addressId } });
}
