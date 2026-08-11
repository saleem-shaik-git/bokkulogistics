import { Injectable } from '@nestjs/common';
import type { EnvConfig } from '@bokku/config';
import type { PaymentProviderKind } from '@bokku/shared';

import { PaymentIntegrationError, type InitializePaymentInput, type InitializePaymentResult, type PaymentProvider, type ReferenceLookup, type VerifiedPayment } from './payment-provider.interface';

interface PaystackEnvelope<T> { status: boolean; message: string; data: T; }
interface PaystackTransactionInit { authorization_url: string; access_code: string; reference: string; }
interface PaystackTransactionData { id: number; reference: string; status: string; amount: number; channel?: string; paid_at?: string; }
interface PaystackRefundData { status?: string; amount?: number; transaction?: number | string; }
const REQUEST_TIMEOUT_MS = 15_000;

@Injectable()
export class PaystackProvider implements PaymentProvider {
  readonly kind: PaymentProviderKind = 'PAYSTACK';
  constructor(private readonly env: EnvConfig) {}
  async initializePayment(input: InitializePaymentInput): Promise<InitializePaymentResult> {
    const result = await this.request<PaystackEnvelope<PaystackTransactionInit>>('POST', '/transaction/initialize', { email: input.email, amount: input.amount, currency: input.currency, reference: input.reference, callback_url: input.callbackUrl, metadata: input.metadata });
    return { reference: result.data.reference, authorizationUrl: result.data.authorization_url, providerReference: result.data.access_code };
  }
  async verifyPayment(reference: string): Promise<VerifiedPayment> {
    const result = await this.request<PaystackEnvelope<PaystackTransactionData>>('GET', `/transaction/verify/${encodeURIComponent(reference)}`);
    const tx = result.data;
    return { reference: tx.reference, paid: tx.status === 'success', amount: tx.amount, channel: tx.channel ?? null, providerReference: String(tx.id), paidAt: tx.paid_at ?? null, rawStatus: tx.status };
  }
  async refundPayment(input: { reference: string; amount?: number }): Promise<ReferenceLookup> {
    const tx = await this.verifyPayment(input.reference);
    if (!tx.providerReference) throw new PaymentIntegrationError('PAYMENT_NOT_REFUNDABLE', `Cannot refund ${input.reference}: not confirmed by Paystack`);

    // Refund creation is asynchronous. Reconcile an existing Paystack refund
    // before creating another one so a crash after POST /refund cannot cause a
    // second refund on the next retry.
    const existing = await this.request<PaystackEnvelope<PaystackRefundData[]>>('GET', `/refund?transaction=${encodeURIComponent(tx.providerReference)}&perPage=50`);
    const matching = (existing.data ?? []).some((refund) => ['pending', 'processing', 'processed'].includes(refund.status ?? '') && (input.amount === undefined || refund.amount === undefined || refund.amount === input.amount));
    if (!matching) {
      await this.request<PaystackEnvelope<unknown>>('POST', '/refund', { transaction: tx.providerReference, ...(input.amount !== undefined ? { amount: input.amount } : {}) });
    }
    return { reference: input.reference, found: true };
  }
  private async request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    const secretKey = this.env.PAYSTACK_SECRET_KEY;
    if (!secretKey) throw new PaymentIntegrationError('PAYMENT_PROVIDER_NOT_CONFIGURED', 'PAYSTACK_SECRET_KEY is not configured');
    const url = `${this.env.PAYSTACK_API_URL}${path}`;
    let response: Response;
    try {
      response = await fetch(url, { method, headers: { authorization: `Bearer ${secretKey}`, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (error) {
      throw new PaymentIntegrationError('PAYMENT_PROVIDER_UNREACHABLE', `Paystack request failed: ${(error as Error).message}`);
    }
    const payload = (await response.json().catch(() => null)) as PaystackEnvelope<unknown> | null;
    if (!response.ok || !payload || payload.status === false) throw new PaymentIntegrationError('PAYMENT_PROVIDER_REJECTED', `Paystack ${method} ${path} failed (${response.status}): ${payload?.message ?? 'unknown error'}`);
    return payload as T;
  }
}
