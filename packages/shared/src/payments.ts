/** Payment contracts shared by the API and the web app. */

export const PAYMENT_PROVIDERS = ['MOCK', 'PAYSTACK'] as const;
export type PaymentProviderKind = (typeof PAYMENT_PROVIDERS)[number];

export const PAYMENT_STATUSES = ['PENDING', 'SUCCESS', 'FAILED', 'ABANDONED', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Our canonical reference prefix — the idempotency key for payments. */
export const PAYMENT_REFERENCE_PREFIX = 'bokku_pay_';

/** Public view of a payment (never includes provider secrets). */
export interface PaymentSummary {
  reference: string;
  provider: PaymentProviderKind;
  status: PaymentStatus;
  /** Integer kobo, snapped from the server-computed checkout breakdown. */
  amount: number;
  currency: string;
  channel: string | null;
  failureReason: string | null;
  paidAt: string | null;
  createdAt: string;
}

/** Result of POST /payments/initialize (a payment + where to send the user to pay). */
export interface InitializePaymentResult extends PaymentSummary {
  authorizationUrl: string;
}

/** Mock checkout simulator outcome (dev/test only, mock provider). */
export type MockPaymentOutcome = 'success' | 'failed';
