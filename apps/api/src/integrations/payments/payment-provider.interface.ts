import type { PaymentProviderKind } from '@bokku/shared';

/**
 * Payment provider abstraction (spec: business modules never call Paystack
 * directly — only through this interface + the factory).
 *
 * Payment confirmation is ONLY trusted from server-side verification:
 * verifyPayment() re-checks the real state with the provider (and webhooks
 * are signature-verified) — client redirects alone never mark anything paid.
 */

export interface InitializePaymentInput {
  /** Our canonical reference — the idempotency key (bokku_pay_…). */
  reference: string;
  /** Integer kobo. */
  amount: number;
  currency: 'NGN';
  email: string;
  /** Where the provider sends the customer's browser back to. */
  callbackUrl: string;
  /** Attached to the provider transaction for reconciliation. */
  metadata: Record<string, unknown>;
}

export interface InitializePaymentResult {
  reference: string;
  authorizationUrl: string;
  /** Provider-side id / access code when issued. */
  providerReference: string | null;
}

/** Normalized provider-side transaction state. */
export interface VerifiedPayment {
  reference: string;
  /** true ⇔ the provider confirms the charge succeeded. */
  paid: boolean;
  /** Amount the provider ACTUALLY charged (kobo) — must match ours. */
  amount: number;
  channel: string | null;
  providerReference: string | null;
  paidAt: string | null;
  /** Provider status string for failure reasons (e.g. 'abandoned'). */
  rawStatus: string;
}

export interface ReferenceLookup {
  reference: string;
  found: boolean;
}

export interface PaymentProvider {
  readonly kind: PaymentProviderKind;
  initializePayment(input: InitializePaymentInput): Promise<InitializePaymentResult>;
  /** Server-side source of truth for a reference's state. */
  verifyPayment(reference: string): Promise<VerifiedPayment>;
  /** Refund a successful payment (wired to order refunds in Phase 7). */
  refundPayment(input: { reference: string; amount?: number }): Promise<ReferenceLookup>;
}

/** Typed integration failure; `code` surfaces in the API error envelope. */
export class PaymentIntegrationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PaymentIntegrationError';
  }
}
