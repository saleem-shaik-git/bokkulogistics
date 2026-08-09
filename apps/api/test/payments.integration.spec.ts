import { createHmac } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  ApiResponse,
  AuthResponse,
  InitializePaymentResult,
  PaymentSummary,
} from '@bokku/shared';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { TEST_DATABASE_URL } from './global-setup';

/**
 * Payment journeys against real PostgreSQL + Redis, mock provider:
 * idempotent initialize, amount-change abandon, webhook signature rules,
 * idempotent/duplicate-safe confirmation, amount mismatch, poll fallback,
 * IDOR protection, retry-after-failure.
 */

interface Envelope<T> {
  status: number;
  body: ApiResponse<T> & { data: T };
}

const WEBHOOK_SECRET = 'ps_webhook_test_secret';
const TEST_REDIS_URL = 'redis://127.0.0.1:6379/1';

let app: INestApplication;
let baseUrl: string;
let sql: postgres.Sql;
let redis: Redis;

let aliceToken: string;
let bobToken: string;
let productA: string;
let addressId: string;

const password = 'Password123!';

async function call<T = unknown>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
    rawBody?: string;
    headers?: Record<string, string>;
  } = {},
): Promise<Envelope<T>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? (options.body || options.rawBody ? 'POST' : 'GET'),
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      ...(options.headers ?? {}),
    },
    body: options.rawBody ?? (options.body ? JSON.stringify(options.body) : undefined),
  });
  return { status: res.status, body: (await res.json()) as Envelope<T>['body'] & { data: T } };
}

function errorCode(res: Envelope<unknown>): string {
  return (res.body as unknown as { error: { code: string } }).error.code;
}

async function login(email: string): Promise<string> {
  const res = await call<AuthResponse>('/auth/login', { body: { email, password } });
  return res.body.data.tokens.accessToken;
}

function signedWebhook(payload: unknown) {
  const rawBody = JSON.stringify(payload);
  return {
    rawBody,
    headers: {
      'x-paystack-signature': createHmac('sha512', WEBHOOK_SECRET).update(rawBody).digest('hex'),
    },
  };
}

async function seedMockOutcome(reference: string, outcome: 'success' | 'failed', amount: number) {
  await redis.set(
    `mockpay:${reference}`,
    JSON.stringify({ outcome, amount, setAt: new Date().toISOString() }),
  );
}

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.REDIS_URL = TEST_REDIS_URL;
  process.env.PAYSTACK_SECRET_KEY = WEBHOOK_SECRET;
  process.env.NODE_ENV = 'test';
  sql = postgres(TEST_DATABASE_URL, { max: 3 });
  redis = new Redis(TEST_REDIS_URL, { lazyConnect: false, maxRetriesPerRequest: 1 });

  app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
  configureApp(app);
  await app.listen(0);
  const address = app.getHttpServer().address();
  if (typeof address === 'string' || !address) throw new Error('no address');
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
}, 60_000);

beforeEach(async () => {
  await sql`TRUNCATE users, stores, categories, products, product_images, inventory, store_staff, carts, cart_items, addresses, payments, audit_logs CASCADE`;
  await redis.flushdb();

  for (const email of ['alice@test.dev', 'bob@test.dev']) {
    await call('/auth/register', { body: { email, password, firstName: 'T', lastName: 'U' } });
  }
  aliceToken = await login('alice@test.dev');
  bobToken = await login('bob@test.dev');

  const [store] = await sql`
    INSERT INTO stores (name, code, address, city, state)
    VALUES ('Bokku', 'BOKKU', '12 Market Street', 'Lagos', 'Lagos') RETURNING id`;
  const [category] = await sql`
    INSERT INTO categories (store_id, name, slug) VALUES (${store!.id}, 'Food', 'food') RETURNING id`;
  const [product] = await sql`
    INSERT INTO products (store_id, category_id, name, slug, sku, price, status)
    VALUES (${store!.id}, ${category!.id}, 'Product A', 'product-a', 'SKU-A', 15_000, 'ACTIVE')
    RETURNING id`;
  productA = product!.id;
  await sql`
    INSERT INTO inventory (store_id, product_id, quantity_on_hand)
    VALUES (${store!.id}, ${productA}, 10)`;

  const addr = await call<{ id: string }>('/addresses', {
    token: aliceToken,
    body: { label: 'Home', street: '24 Allen Avenue, Ikeja', city: 'Lagos', state: 'Lagos' },
  });
  addressId = addr.body.data.id;

  // Baseline cart: 2 × ₦150 → subtotal ₦300, mock delivery ₦1,250 (5km fallback),
  // fee ₦15, VAT ₦22.50 → total ₦1,587.50 = 158_750 kobo.
  await call('/cart/items', { token: aliceToken, body: { productId: productA, quantity: 2 } });
});

afterAll(async () => {
  await app?.close();
  await sql?.end();
  redis?.disconnect();
});

describe('initialize', () => {
  it('requires authentication', async () => {
    expect((await call('/payments/initialize', { body: { addressId } })).status).toBe(401);
  });

  it('rejects an empty cart', async () => {
    await call('/cart', { method: 'DELETE', token: aliceToken });
    const res = await call('/payments/initialize', { token: aliceToken, body: { addressId } });
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('CART_EMPTY');
  });

  it('creates a pending payment with the server-computed amount', async () => {
    const res = await call<InitializePaymentResult>('/payments/initialize', {
      token: aliceToken,
      body: { addressId },
    });
    expect(res.status).toBe(201);
    const payment = res.body.data;
    expect(payment.reference).toMatch(/^bokku_pay_[0-9a-f]{32}$/);
    expect(payment.amount).toBe(158_750);
    expect(payment.currency).toBe('NGN');
    expect(payment.status).toBe('PENDING');
    expect(payment.provider).toBe('MOCK');
    expect(payment.authorizationUrl).toContain('/payment/mock?reference=');

    const [row] = await sql`SELECT metadata FROM payments WHERE reference = ${payment.reference}`;
    expect((row!.metadata as { breakdown: { total: number } }).breakdown.total).toBe(158_750);

    const audits = await sql`SELECT action FROM audit_logs WHERE action = 'payment.initialized'`;
    expect(audits).toHaveLength(1);
  });

  it('is idempotent: same cart and total ⇒ same reference, one row, one audit', async () => {
    const first = await call<InitializePaymentResult>('/payments/initialize', {
      token: aliceToken,
      body: { addressId },
    });
    const second = await call<InitializePaymentResult>('/payments/initialize', {
      token: aliceToken,
      body: { addressId },
    });
    expect(second.body.data.reference).toBe(first.body.data.reference);
    expect(second.body.data.authorizationUrl).toBe(first.body.data.authorizationUrl);

    const [count] = await sql`SELECT count(*)::int AS n FROM payments`;
    expect(count!.n).toBe(1);
    const audits = await sql`SELECT action FROM audit_logs WHERE action = 'payment.initialized'`;
    expect(audits).toHaveLength(1);
  });

  it('abandons the stale pending row when the cart total changed', async () => {
    const first = await call<InitializePaymentResult>('/payments/initialize', {
      token: aliceToken,
      body: { addressId },
    });
    // Cart change: 2 → 3 units.
    const cart = await call<{ items: Array<{ id: string }> }>('/cart', { token: aliceToken });
    await call(`/cart/items/${cart.body.data.items[0]!.id}`, {
      method: 'PATCH',
      token: aliceToken,
      body: { quantity: 3 },
    });

    const second = await call<InitializePaymentResult>('/payments/initialize', {
      token: aliceToken,
      body: { addressId },
    });
    expect(second.body.data.reference).not.toBe(first.body.data.reference);
    // 3 × 15_000 = 45_000; +125_000 + 2_250 + 3_375 = 175_625
    expect(second.body.data.amount).toBe(175_625);

    const rows = await sql`SELECT status FROM payments ORDER BY created_at`;
    expect(rows.map((r) => r.status)).toEqual(['ABANDONED', 'PENDING']);
  });
});

describe('confirmation via the mock checkout', () => {
  async function initialize(): Promise<InitializePaymentResult> {
    const res = await call<InitializePaymentResult>('/payments/initialize', {
      token: aliceToken,
      body: { addressId },
    });
    return res.body.data;
  }

  it('settles success through the same path a real webhook drives', async () => {
    const payment = await initialize();
    const completed = await call<PaymentSummary>('/payments/mock/complete', {
      body: { reference: payment.reference, outcome: 'success' },
    });
    expect(completed.status).toBe(201);
    expect(completed.body.data.status).toBe('SUCCESS');
    expect(completed.body.data.channel).toBe('mock');
    expect(completed.body.data.paidAt).toBeTruthy();

    const audits = await sql`SELECT action FROM audit_logs WHERE action = 'payment.succeeded'`;
    expect(audits).toHaveLength(1);
  });

  it('marks failed payments and lets the customer retry with a fresh reference', async () => {
    const payment = await initialize();
    const completed = await call<PaymentSummary>('/payments/mock/complete', {
      body: { reference: payment.reference, outcome: 'failed' },
    });
    expect(completed.body.data.status).toBe('FAILED');
    expect(completed.body.data.failureReason).toBe('FAILED');

    const retry = await call<InitializePaymentResult>('/payments/initialize', {
      token: aliceToken,
      body: { addressId },
    });
    expect(retry.body.data.reference).not.toBe(payment.reference);
    const rows = await sql`SELECT status FROM payments ORDER BY created_at`;
    expect(rows.map((r) => r.status)).toEqual(['FAILED', 'PENDING']);
  });

  it('blocks re-initializing a paid cart', async () => {
    const payment = await initialize();
    await call('/payments/mock/complete', {
      body: { reference: payment.reference, outcome: 'success' },
    });
    const again = await call('/payments/initialize', { token: aliceToken, body: { addressId } });
    expect(again.status).toBe(409);
    expect(errorCode(again)).toBe('CART_ALREADY_PAID');
  });

  it('404s mock/complete for unknown references', async () => {
    const res = await call('/payments/mock/complete', {
      body: {
        reference: 'bokku_pay_0000000000000000000000000000dead',
        outcome: 'success',
      },
    });
    expect(res.status).toBe(404);
  });
});

describe('paystack webhook', () => {
  async function initialize(): Promise<InitializePaymentResult> {
    const res = await call<InitializePaymentResult>('/payments/initialize', {
      token: aliceToken,
      body: { addressId },
    });
    return res.body.data;
  }

  it('rejects invalid signatures with 401 + audit', async () => {
    const payment = await initialize();
    const res = await call('/payments/webhook/paystack', {
      rawBody: JSON.stringify({ event: 'charge.success', data: { reference: payment.reference } }),
      headers: { 'x-paystack-signature': 'invalid_signature' },
    });
    expect(res.status).toBe(401);
    expect(errorCode(res)).toBe('PAYMENT_WEBHOOK_SIGNATURE_INVALID');

    const audits =
      await sql`SELECT action FROM audit_logs WHERE action = 'payment.webhook_rejected'`;
    expect(audits).toHaveLength(1);
  });

  it('acknowledges unknown references without erroring (no retry storms)', async () => {
    const res = await call<{ received: boolean }>(
      '/payments/webhook/paystack',
      signedWebhook({
        event: 'charge.success',
        data: { reference: 'bokku_pay_0000000000000000000000000000beef' },
      }),
    );
    expect(res.status).toBe(201); // POST default; envelope says received
    expect(res.body.data.received).toBe(true);
  });

  it('confirms through provider verification when properly signed', async () => {
    const payment = await initialize();
    await seedMockOutcome(payment.reference, 'success', payment.amount);

    const res = await call<{ received: boolean }>(
      '/payments/webhook/paystack',
      signedWebhook({ event: 'charge.success', data: { reference: payment.reference } }),
    );
    expect(res.body.data.received).toBe(true);

    const row =
      await sql`SELECT status, channel FROM payments WHERE reference = ${payment.reference}`;
    expect(row[0]).toMatchObject({ status: 'SUCCESS', channel: 'mock' });
  });

  it('is duplicate-safe: repeated delivery never re-applies', async () => {
    const payment = await initialize();
    await seedMockOutcome(payment.reference, 'success', payment.amount);
    const event = signedWebhook({
      event: 'charge.success',
      data: { reference: payment.reference },
    });

    await call('/payments/webhook/paystack', event);
    const [first] = await sql`SELECT paid_at FROM payments WHERE reference = ${payment.reference}`;
    await call('/payments/webhook/paystack', event);
    await call('/payments/webhook/paystack', event);
    const [last] = await sql`SELECT paid_at FROM payments WHERE reference = ${payment.reference}`;

    expect(new Date(last!.paid_at as Date).getTime()).toBe(
      new Date(first!.paid_at as Date).getTime(),
    );
    const audits = await sql`SELECT action FROM audit_logs WHERE action = 'payment.succeeded'`;
    expect(audits).toHaveLength(1);
  });

  it('fails safely on amount mismatch and audits the security event', async () => {
    const payment = await initialize();
    await seedMockOutcome(payment.reference, 'success', payment.amount + 1);

    await call(
      '/payments/webhook/paystack',
      signedWebhook({ event: 'charge.success', data: { reference: payment.reference } }),
    );
    const [row] =
      await sql`SELECT status, failure_reason FROM payments WHERE reference = ${payment.reference}`;
    expect(row).toMatchObject({ status: 'FAILED', failure_reason: 'AMOUNT_MISMATCH' });

    const audits =
      await sql`SELECT action FROM audit_logs WHERE action = 'payment.amount_mismatch'`;
    expect(audits).toHaveLength(1);
  });
});

describe('payment lookup', () => {
  it('re-verifies a pending payment on read (webhook-lag fallback)', async () => {
    const res = await call<InitializePaymentResult>('/payments/initialize', {
      token: aliceToken,
      body: { addressId },
    });
    const reference = res.body.data.reference;
    await seedMockOutcome(reference, 'success', res.body.data.amount);

    // No webhook, no mock/complete — the owner polling the payment settles it.
    const read = await call<PaymentSummary>(`/payments/${reference}`, { token: aliceToken });
    expect(read.status).toBe(200);
    expect(read.body.data.status).toBe('SUCCESS');
  });

  it('scopes lookups to the owner and validates the reference shape', async () => {
    const res = await call<InitializePaymentResult>('/payments/initialize', {
      token: aliceToken,
      body: { addressId },
    });
    const reference = res.body.data.reference;

    const otherUser = await call(`/payments/${reference}`, { token: bobToken });
    expect(otherUser.status).toBe(404);
    expect(errorCode(otherUser)).toBe('PAYMENT_NOT_FOUND');

    const garbage = await call('/payments/not-a-real-reference', { token: aliceToken });
    expect(garbage.status).toBe(400);
  });
});
