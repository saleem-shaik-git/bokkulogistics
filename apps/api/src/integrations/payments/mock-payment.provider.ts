import { Inject, Injectable } from '@nestjs/common';
import type { EnvConfig } from '@bokku/config';
import type { MockPaymentOutcome, PaymentProviderKind } from '@bokku/shared';
import type { Redis } from 'ioredis';

import { ENV_CONFIG, REDIS_CLIENT } from '../../config/constants';
import {
  PaymentIntegrationError,
  type InitializePaymentInput,
  type InitializePaymentResult,
  type PaymentProvider,
  type ReferenceLookup,
  type VerifiedPayment,
} from './payment-provider.interface';

interface MockOutcomeRecord {
  outcome: MockPaymentOutcome;
  amount: number;
  setAt: string;
}

const MOCK_KEY_TTL_SECONDS = 60 * 60;
const mockKey = (reference: string) => `mockpay:${reference}`;

/**
 * Mock Paystack-shaped provider (default until real keys exist — spec
 * mandates MOCK keeps the whole app functional).
 *
 * It is an honest simulation, not a shortcut: initialize redirects to the
 * web app's mock checkout page, the page reports the outcome through
 * POST /payments/mock/complete (this provider records it in Redis), and
 * the platform then confirms via the SAME server-side verifyPayment +
 * confirmation path the real Paystack webhook drives. Payment rows are
 * never marked paid without going through confirmFromProvider().
 */
@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly kind: PaymentProviderKind = 'MOCK';

  constructor(
    @Inject(ENV_CONFIG) private readonly env: EnvConfig,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  initializePayment(input: InitializePaymentInput): Promise<InitializePaymentResult> {
    // Relative URL on purpose: the mock checkout lives in our own web app,
    // and a relative target keeps working behind any preview proxy/origin
    // (the browser is not the server). Real Paystack returns an absolute
    // hosted-checkout URL — the client just navigates to whatever it gets.
    return Promise.resolve({
      reference: input.reference,
      authorizationUrl: `/payment/mock?reference=${encodeURIComponent(input.reference)}`,
      providerReference: `mock_${input.reference}`,
    });
  }

  /** Dev/test-only: the mock checkout page reports the simulated outcome. */
  async simulateOutcome(
    reference: string,
    outcome: MockPaymentOutcome,
    amount: number,
  ): Promise<void> {
    const record: MockOutcomeRecord = { outcome, amount, setAt: new Date().toISOString() };
    await this.redis.set(mockKey(reference), JSON.stringify(record), 'EX', MOCK_KEY_TTL_SECONDS);
  }

  async verifyPayment(reference: string): Promise<VerifiedPayment> {
    const raw = await this.redis.get(mockKey(reference));
    if (!raw) {
      return {
        reference,
        paid: false,
        amount: 0,
        channel: null,
        providerReference: `mock_${reference}`,
        paidAt: null,
        rawStatus: 'pending',
      };
    }
    const record = JSON.parse(raw) as MockOutcomeRecord;
    const paid = record.outcome === 'success';
    return {
      reference,
      paid,
      amount: record.amount,
      channel: 'mock',
      providerReference: `mock_${reference}`,
      paidAt: paid ? record.setAt : null,
      rawStatus: record.outcome,
    };
  }

  async refundPayment(input: { reference: string }): Promise<ReferenceLookup> {
    const raw = await this.redis.get(mockKey(input.reference));
    if (!raw) {
      throw new PaymentIntegrationError(
        'PAYMENT_NOT_REFUNDABLE',
        `Cannot refund ${input.reference}: not confirmed paid (mock)`,
      );
    }
    const record = JSON.parse(raw) as MockOutcomeRecord;
    if (record.outcome !== 'success') {
      throw new PaymentIntegrationError(
        'PAYMENT_NOT_REFUNDABLE',
        `Cannot refund ${input.reference}: mock outcome is ${record.outcome}`,
      );
    }
    // The payment stays paid provider-side; the REFUNDED business state is
    // tracked on our payments row (Phase 7 refunds flow through orders).
    return { reference: input.reference, found: true };
  }
}
