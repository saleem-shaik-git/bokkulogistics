import { createHmac } from 'node:crypto';

import { describe, expect, it } from 'vitest';
import type { EnvConfig } from '@bokku/config';
import type { Redis } from 'ioredis';

import { MockPaymentProvider } from '../src/integrations/payments/mock-payment.provider';
import { PaymentProviderFactory } from '../src/integrations/payments/payment-provider.factory';
import { PaymentIntegrationError } from '../src/integrations/payments/payment-provider.interface';
import { verifyPaystackSignature } from '../src/integrations/payments/paystack-signature';
import { PaystackProvider } from '../src/integrations/payments/paystack.provider';

function env(overrides: Partial<EnvConfig>): EnvConfig {
  return {
    APP_URL: 'https://shop.example.test',
    PAYMENT_PROVIDER: 'MOCK',
    PAYSTACK_API_URL: 'https://api.paystack.co',
    ...overrides,
  } as EnvConfig;
}

/** Minimal in-memory Redis stub exercised by the mock provider. */
function fakeRedis(): Redis {
  const store = new Map<string, string>();
  return {
    set: async (key: string, value: string) => (store.set(key, value), 'OK'),
    get: async (key: string) => store.get(key) ?? null,
  } as unknown as Redis;
}

describe('verifyPaystackSignature', () => {
  const secret = 'sk_test_webhook_secret';
  const body = Buffer.from('{"event":"charge.success","data":{"reference":"bokku_pay_x"}}');

  it('accepts a correctly signed payload', () => {
    const signature = createHmac('sha512', secret).update(body).digest('hex');
    expect(verifyPaystackSignature(body, signature, secret)).toBe(true);
  });

  it('rejects wrong, missing, or tampered signatures', () => {
    expect(verifyPaystackSignature(body, undefined, secret)).toBe(false);
    expect(verifyPaystackSignature(body, 'deadbeef', secret)).toBe(false);
    const signedOther = createHmac('sha512', secret).update('{"event":"other"}').digest('hex');
    expect(verifyPaystackSignature(body, signedOther, secret)).toBe(false);
    const wrongSecret = createHmac('sha512', 'another_secret').update(body).digest('hex');
    expect(verifyPaystackSignature(body, wrongSecret, secret)).toBe(false);
  });
});

describe('PaymentProviderFactory', () => {
  const redis = fakeRedis();

  it('defaults to the mock provider', () => {
    const provider = new PaymentProviderFactory(env({}), redis).create();
    expect(provider.kind).toBe('MOCK');
  });

  it('builds Paystack only when the secret key exists', () => {
    const unconfigured = new PaymentProviderFactory(env({ PAYMENT_PROVIDER: 'PAYSTACK' }), redis);
    expect(() => unconfigured.create()).toThrowError(PaymentIntegrationError);
    expect(() => unconfigured.create()).toThrowError(/PAYSTACK_SECRET_KEY/);

    const configured = new PaymentProviderFactory(
      env({ PAYMENT_PROVIDER: 'PAYSTACK', PAYSTACK_SECRET_KEY: 'sk_test_x' }),
      redis,
    ).create();
    expect(configured).toBeInstanceOf(PaystackProvider);
    expect(configured.kind).toBe('PAYSTACK');
  });

  it('fails clearly on an unknown provider value', () => {
    const factory = new PaymentProviderFactory(
      env({ PAYMENT_PROVIDER: 'FLUTTERWAVE' as never }),
      redis,
    );
    expect(() => factory.create()).toThrowError(/Unknown payment provider/);
  });
});

describe('MockPaymentProvider', () => {
  it('initializes to the web mock checkout page and stays pending until an outcome is set', async () => {
    const provider = new MockPaymentProvider(env({}), fakeRedis());
    const session = await provider.initializePayment({
      reference: 'bokku_pay_abc',
      amount: 158_750,
      currency: 'NGN',
      email: 't@t.dev',
      callbackUrl: 'https://shop.example.test/payment/result',
      metadata: {},
    });
    expect(session.authorizationUrl).toBe('/payment/mock?reference=bokku_pay_abc');

    const pending = await provider.verifyPayment('bokku_pay_abc');
    expect(pending.paid).toBe(false);
    expect(pending.rawStatus).toBe('pending');
  });

  it('reflects simulated outcomes in verification', async () => {
    const provider = new MockPaymentProvider(env({}), fakeRedis());
    await provider.simulateOutcome('bokku_pay_ok', 'success', 50_000);
    const verified = await provider.verifyPayment('bokku_pay_ok');
    expect(verified).toMatchObject({ paid: true, amount: 50_000, channel: 'mock' });
    expect(verified.paidAt).toBeTruthy();

    await provider.simulateOutcome('bokku_pay_no', 'failed', 50_000);
    expect((await provider.verifyPayment('bokku_pay_no')).paid).toBe(false);
    expect((await provider.verifyPayment('bokku_pay_no')).rawStatus).toBe('failed');
  });

  it('refunds only confirmed payments', async () => {
    const provider = new MockPaymentProvider(env({}), fakeRedis());
    await expect(provider.refundPayment({ reference: 'bokku_pay_none' })).rejects.toMatchObject({
      code: 'PAYMENT_NOT_REFUNDABLE',
    });
    await provider.simulateOutcome('bokku_pay_ref', 'success', 10_000);
    await expect(provider.refundPayment({ reference: 'bokku_pay_ref' })).resolves.toEqual({
      reference: 'bokku_pay_ref',
      found: true,
    });
  });
});

describe('PaystackProvider HTTP mapping', () => {
  const provider = new PaystackProvider(
    env({ PAYSTACK_SECRET_KEY: 'sk_test_x', PAYSTACK_API_URL: 'https://paystack.test' }),
  );

  it('posts kobo amounts with bearer auth on initialize', async () => {
    const calls: Array<{
      url: string;
      headers?: Record<string, string>;
      body?: unknown;
    }> = [];
    const fetchMock = async (
      input: unknown,
      init?: { headers?: Record<string, string>; body?: unknown },
    ) => {
      calls.push({
        url: String(input),
        headers: init?.headers,
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : init?.body,
      });
      return new Response(
        JSON.stringify({
          status: true,
          message: 'ok',
          data: {
            authorization_url: 'https://paystack.test/pay/abc',
            access_code: 'acc_1',
            reference: 'bokku_pay_1',
          },
        }),
        { status: 200 },
      );
    };
    const original = globalThis.fetch;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      const result = await provider.initializePayment({
        reference: 'bokku_pay_1',
        amount: 740_000,
        currency: 'NGN',
        email: 'c@t.dev',
        callbackUrl: 'https://shop.example.test/payment/result',
        metadata: { cartId: 'c1' },
      });
      expect(result.authorizationUrl).toBe('https://paystack.test/pay/abc');
      expect(calls).toHaveLength(1);
      const request = calls[0]!;
      expect(request.url).toBe('https://paystack.test/transaction/initialize');
      expect(request.headers?.authorization).toBe('Bearer sk_test_x');
      expect(request.body).toMatchObject({
        amount: 740_000,
        currency: 'NGN',
        reference: 'bokku_pay_1',
      });
    } finally {
      globalThis.fetch = original;
    }
  });

  it('maps provider failures to typed integration errors', async () => {
    const original = globalThis.fetch;
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ status: false, message: 'Invalid key' }), {
        status: 401,
      })) as typeof fetch;
    try {
      await expect(provider.verifyPayment('bokku_pay_1')).rejects.toMatchObject({
        code: 'PAYMENT_PROVIDER_REJECTED',
      });
    } finally {
      globalThis.fetch = original;
    }
  });
});
