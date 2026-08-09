import { Injectable } from '@nestjs/common';
import type { EnvConfig } from '@bokku/config';
import type { PaymentProviderKind } from '@bokku/shared';

import {
  PaymentIntegrationError,
  type InitializePaymentInput,
  type InitializePaymentResult,
  type PaymentProvider,
  type ReferenceLookup,
  type VerifiedPayment,
} from './payment-provider.interface';

/** Small typed slice of Paystack API responses. */
interface PaystackEnvelope<T> {
  status: boolean;
  message: string;
  data: T;
}

interface PaystackTransactionInit {
  authorization_url: string;
  access_code: string;
  reference: string;
}

interface PaystackTransactionData {
  id: number;
  reference: string;
  status: string; // 'success' | 'failed' | 'abandoned' | …
  amount: number; // kobo
  channel?: string;
  paid_at?: string;
}

const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Real Paystack adapter (used when PAYMENT_PROVIDER=PAYSTACK with
 * PAYSTACK_SECRET_KEY configured). Amounts are exchanged in kobo exactly
 * like the rest of the platform. All calls are server-to-server with the
 * secret key (never exposed to the frontend).
 */
@Injectable()
export class PaystackProvider implements PaymentProvider {
  readonly kind: PaymentProviderKind = 'PAYSTACK';

  constructor(private readonly env: EnvConfig) {}

  async initializePayment(input: InitializePaymentInput): Promise<InitializePaymentResult> {
    const result = await this.request<PaystackEnvelope<PaystackTransactionInit>>(
      'POST',
      '/transaction/initialize',
      {
        email: input.email,
        amount: input.amount,
        currency: input.currency,
        reference: input.reference,
        callback_url: input.callbackUrl,
        metadata: input.metadata,
      },
    );
    return {
      reference: result.data.reference,
      authorizationUrl: result.data.authorization_url,
      providerReference: result.data.access_code,
    };
  }

  async verifyPayment(reference: string): Promise<VerifiedPayment> {
    const result = await this.request<PaystackEnvelope<PaystackTransactionData>>(
      'GET',
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );
    const tx = result.data;
    return {
      reference: tx.reference,
      paid: tx.status === 'success',
      amount: tx.amount,
      channel: tx.channel ?? null,
      providerReference: String(tx.id),
      paidAt: tx.paid_at ?? null,
      rawStatus: tx.status,
    };
  }

  async refundPayment(input: { reference: string; amount?: number }): Promise<ReferenceLookup> {
    const tx = await this.verifyPayment(input.reference);
    if (!tx.providerReference) {
      throw new PaymentIntegrationError(
        'PAYMENT_NOT_REFUNDABLE',
        `Cannot refund ${input.reference}: not confirmed by Paystack`,
      );
    }
    await this.request<PaystackEnvelope<unknown>>('POST', '/refund', {
      transaction: tx.providerReference,
      ...(input.amount !== undefined ? { amount: input.amount } : {}),
    });
    return { reference: input.reference, found: true };
  }

  // ── HTTP plumbing ───────────────────────────────────────────────

  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const secretKey = this.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) {
      throw new PaymentIntegrationError(
        'PAYMENT_PROVIDER_NOT_CONFIGURED',
        'PAYSTACK_SECRET_KEY is not configured',
      );
    }
    const url = `${this.env.PAYSTACK_API_URL}${path}`;
    let response: Response;
    try {
      response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${secretKey}`,
          'content-type': 'application/json',
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      throw new PaymentIntegrationError(
        'PAYMENT_PROVIDER_UNREACHABLE',
        `Paystack request failed: ${(error as Error).message}`,
      );
    }

    const payload = (await response.json().catch(() => null)) as PaystackEnvelope<unknown> | null;
    if (!response.ok || !payload || payload.status === false) {
      throw new PaymentIntegrationError(
        'PAYMENT_PROVIDER_REJECTED',
        `Paystack ${method} ${path} failed (${response.status}): ${payload?.message ?? 'unknown error'}`,
      );
    }
    return payload as T;
  }
}
