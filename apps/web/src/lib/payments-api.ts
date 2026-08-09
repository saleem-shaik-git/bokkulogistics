import type { InitializePaymentResult, MockPaymentOutcome, PaymentSummary } from '@bokku/shared';

import { authedRequest } from './authed-api';

/**
 * Payments. The web NEVER says how much a payment is — amounts come from
 * the server-computed checkout breakdown; the client only says which
 * address the order goes to and which reference it's asking about.
 */
export function initializePayment(input: {
  addressId: string;
  callbackUrl?: string;
}): Promise<InitializePaymentResult> {
  return authedRequest<InitializePaymentResult>('/payments/initialize', { body: input });
}

/** Owner-scoped payment status; the API re-verifies PENDING payments live. */
export function fetchPayment(reference: string): Promise<PaymentSummary> {
  return authedRequest<PaymentSummary>(`/payments/${encodeURIComponent(reference)}`);
}

/** Dev/test-only: report the outcome at the mock checkout (mock provider). */
export function completeMockPayment(
  reference: string,
  outcome: MockPaymentOutcome,
): Promise<PaymentSummary> {
  return authedRequest<PaymentSummary>('/payments/mock/complete', {
    body: { reference, outcome },
  });
}

// NOTE: /payments/mock/complete is public — the mock checkout URL acts as
// the capability, exactly like a hosted PSP page. authedRequest attaches
// the token when present, which the endpoint simply ignores.
