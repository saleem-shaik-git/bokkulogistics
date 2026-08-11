import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  ApiResponse,
  AuthResponse,
  InitializePaymentResult,
  Paginated,
  PaymentSummary,
  PublicOrderDetail,
  PublicOrderSummary,
} from '@bokku/shared';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { TEST_DATABASE_URL } from './global-setup';

/**
 * Order journeys against real PostgreSQL + Redis, mock payment provider:
 * automatic payment→order conversion, idempotent placement, ownership,
 * snapshot integrity, inventory reservations (incl. oversell races),
 * the state machine as staff drive it, and the cancel/refund path.
 */

interface Envelope<T> {
  status: number;
  body: ApiResponse<T> & { data: T };
}

const TEST_REDIS_URL = 'redis://127.0.0.1:6379/1';

let app: INestApplication;
let baseUrl: string;
let sql: postgres.Sql;
let redis: Redis;

let aliceToken: string;
let bobToken: string;
let managerToken: string;
let customerToken: string;
let rogueToken: string;
let aliceAddressId: string;
let bobAddressId: string;
let productA: string;

const password = 'Password123!';

async function call<T = unknown>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    token?: string;
  } = {},
): Promise<Envelope<T>> {
  const res = await fetch(`${baseUrl}${path}`, {
    method: options.method ?? (options.body ? 'POST' : 'GET'),
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
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

async function createUser(email: string, role = 'CUSTOMER') {
  await call('/auth/register', { body: { email, password, firstName: 'T', lastName: 'U' } });
  await sql`UPDATE users SET role = ${role} WHERE email = ${email}`;
}

/** Add `quantity` of product A, initialize, settle — returns the reference. */
async function pay(token: string, addressId: string, quantity: number): Promise<string> {
  await call('/cart/items', { token, body: { productId: productA, quantity } });
  const init = await call<InitializePaymentResult>('/payments/initialize', {
    token,
    body: { addressId },
  });
  expect(init.status).toBe(201);
  const reference = init.body.data.reference;
  const settled = await call<PaymentSummary>('/payments/mock/complete', {
    body: { reference, outcome: 'success' },
  });
  expect(settled.body.data.status).toBe('SUCCESS');
  return reference;
}

async function inventoryRow() {
  const [row] = await sql`
    SELECT quantity_on_hand AS on_hand, reserved_quantity AS reserved
    FROM inventory WHERE product_id = ${productA}`;
  return row!;
}

async function auditActions(action: string) {
  return sql`SELECT metadata FROM audit_logs WHERE action = ${action} ORDER BY created_at`;
}

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.REDIS_URL = TEST_REDIS_URL;
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
  await sql`TRUNCATE users, stores, categories, products, product_images, inventory, store_staff, carts, cart_items, addresses, payments, orders, order_items, audit_logs CASCADE`;
  await redis.flushdb();

  await createUser('alice@test.dev');
  await createUser('bob@test.dev');
  await createUser('customer@test.dev');
  await createUser('manager@test.dev', 'STORE_MANAGER');
  await createUser('rogue@test.dev', 'STORE_MANAGER'); // no store_staff link

  const [store] = await sql`
    INSERT INTO stores (name, code, address, city, state)
    VALUES ('Bokku', 'BOKKU', '12 Market Street', 'Lagos', 'Lagos') RETURNING id, code`;
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

  const [manager] = await sql`SELECT id FROM users WHERE email = 'manager@test.dev'`;
  await sql`INSERT INTO store_staff (store_id, user_id) VALUES (${store!.id}, ${manager!.id})`;

  aliceToken = await login('alice@test.dev');
  bobToken = await login('bob@test.dev');
  customerToken = await login('customer@test.dev');
  managerToken = await login('manager@test.dev');
  rogueToken = await login('rogue@test.dev');

  const aliceAddr = await call<{ id: string }>('/addresses', {
    token: aliceToken,
    body: { label: 'Home', street: '24 Allen Avenue, Ikeja', city: 'Lagos', state: 'Lagos' },
  });
  aliceAddressId = aliceAddr.body.data.id;
  const bobAddr = await call<{ id: string }>('/addresses', {
    token: bobToken,
    body: { label: 'Office', street: '1 Adeola Odeku, VI', city: 'Lagos', state: 'Lagos' },
  });
  bobAddressId = bobAddr.body.data.id;
});

afterAll(async () => {
  await app?.close();
  await sql?.end();
  redis?.disconnect();
});

describe('conversion (payment → order)', () => {
  it('auto-converts a settled payment into a PAID order with reservations', async () => {
    // Baseline: 2 × ₦150 → subtotal ₦300, delivery ₦1,250 (5km fallback),
    // service fee ₦15, VAT ₦22.50 → total 158_750 kobo.
    const reference = await pay(aliceToken, aliceAddressId, 2);

    const [order] = await sql`
      SELECT status, order_number, subtotal, delivery_fee, service_fee, tax, discount, total,
             currency, paid_at, payment_id, cart_id
      FROM orders WHERE payment_reference = ${reference}`;
    expect(order).toBeDefined();
    expect(order!.status).toBe('PAID');
    expect(order!.order_number).toMatch(/^BK-\d{8}-[A-Z2-9]{6}$/);
    expect(order!.subtotal).toBe(30_000);
    expect(order!.delivery_fee).toBe(125_000);
    expect(order!.service_fee).toBe(1_500);
    expect(order!.tax).toBe(2_250);
    expect(order!.discount).toBe(0);
    expect(order!.total).toBe(158_750);
    expect(order!.currency).toBe('NGN');
    expect(order!.paid_at).not.toBeNull();
    expect(order!.payment_id).toBeTruthy();

    const items = await sql`SELECT name, sku, unit_price, quantity, line_total FROM order_items`;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      name: 'Product A',
      sku: 'SKU-A',
      unit_price: 15_000,
      quantity: 2,
      line_total: 30_000,
    });

    // Stock reserved, source cart consumed, both lifecycle audits written.
    expect((await inventoryRow()).reserved).toBe(2);
    const carts = await sql`SELECT count(*)::int AS n FROM carts`;
    expect(carts[0]!.n).toBe(0);

    expect(await auditActions('order.created')).toHaveLength(1);
    const statusChanges = await auditActions('order.status_changed');
    expect(statusChanges).toHaveLength(1);
    expect((statusChanges[0]!.metadata as { from: string; to: string }).from).toBe(
      'PENDING_PAYMENT',
    );
    expect((statusChanges[0]!.metadata as { to: string }).to).toBe('PAID');
  });

  it('POST /orders converges on the same order (retries/double-clicks safe)', async () => {
    const reference = await pay(aliceToken, aliceAddressId, 2);

    const first = await call<PublicOrderDetail>('/orders', {
      token: aliceToken,
      body: { paymentReference: reference },
    });
    const second = await call<PublicOrderDetail>('/orders', {
      token: aliceToken,
      body: { paymentReference: reference },
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(second.body.data.orderNumber).toBe(first.body.data.orderNumber);
    expect(second.body.data.items).toHaveLength(1);
    expect(second.body.data.deliveryAddress.street).toBe('24 Allen Avenue, Ikeja');
    expect(second.body.data.deliveryQuote.provider).toBe('MOCK');
    expect(second.body.data.paymentReference).toBe(reference);

    const [count] = await sql`SELECT count(*)::int AS n FROM orders`;
    expect(count!.n).toBe(1);
    expect(await auditActions('order.created')).toHaveLength(1);
    expect((await inventoryRow()).reserved).toBe(2);
  });

  it('404s another user’s payment reference', async () => {
    const reference = await pay(aliceToken, aliceAddressId, 1);
    const res = await call('/orders', {
      token: bobToken,
      body: { paymentReference: reference },
    });
    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('PAYMENT_NOT_FOUND');
  });

  it('409s an unsettled (still pending) reference', async () => {
    await call('/cart/items', { token: aliceToken, body: { productId: productA, quantity: 1 } });
    const init = await call<InitializePaymentResult>('/payments/initialize', {
      token: aliceToken,
      body: { addressId: aliceAddressId },
    });
    const res = await call('/orders', {
      token: aliceToken,
      body: { paymentReference: init.body.data.reference },
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('PAYMENT_NOT_SETTLED');
  });

  it('rejects malformed references at the door', async () => {
    const res = await call('/orders', {
      token: aliceToken,
      body: { paymentReference: 'bokku_pay_NOTHEX' },
    });
    expect(res.status).toBe(400);
  });

  it('keeps item snapshots immutable against later catalogue edits', async () => {
    const reference = await pay(aliceToken, aliceAddressId, 2);
    const placed = await call<PublicOrderDetail>('/orders', {
      token: aliceToken,
      body: { paymentReference: reference },
    });
    await sql`UPDATE products SET name = 'Renamed Product', price = 999_999 WHERE id = ${productA}`;

    const detail = await call<PublicOrderDetail>(`/orders/${placed.body.data.id}`, {
      token: aliceToken,
    });
    expect(detail.status).toBe(200);
    expect(detail.body.data.items[0]!.name).toBe('Product A');
    expect(detail.body.data.items[0]!.unitPrice).toBe(15_000);
    expect(detail.body.data.subtotal).toBe(30_000);
    expect(detail.body.data.total).toBe(158_750);
  });
});

describe('inventory reservation', () => {
  it('blocks an oversell race: paying first wins the stock', async () => {
    // Bob initializes FIRST (5 units, no reservation yet)…
    await call('/cart/items', { token: bobToken, body: { productId: productA, quantity: 5 } });
    const bobInit = await call<InitializePaymentResult>('/payments/initialize', {
      token: bobToken,
      body: { addressId: bobAddressId },
    });
    const bobReference = bobInit.body.data.reference;
    // …then Alice pays 6 and converts — reserved 6 of 10.
    await pay(aliceToken, aliceAddressId, 6);
    expect((await inventoryRow()).reserved).toBe(6);

    // Bob’s money clears, but only 4 units remain sellable: conversion fails.
    const settled = await call<PaymentSummary>('/payments/mock/complete', {
      body: { reference: bobReference, outcome: 'success' },
    });
    expect(settled.body.data.status).toBe('SUCCESS');

    const placed = await call('/orders', {
      token: bobToken,
      body: { paymentReference: bobReference },
    });
    expect(placed.status).toBe(409);
    expect(errorCode(placed)).toBe('INSUFFICIENT_STOCK');

    // No partial order, reservation untouched, both failed attempts audited.
    const [count] = await sql`SELECT count(*)::int AS n FROM orders`;
    expect(count!.n).toBe(1);
    expect((await inventoryRow()).reserved).toBe(6);
    expect(await auditActions('order.conversion_failed')).toHaveLength(2);
  });
});

describe('customer surface', () => {
  it('lists only my orders and scopes detail lookups to the owner', async () => {
    const reference = await pay(aliceToken, aliceAddressId, 2);
    const placed = await call<PublicOrderDetail>('/orders', {
      token: aliceToken,
      body: { paymentReference: reference },
    });
    const orderId = placed.body.data.id;

    const mine = await call<Paginated<PublicOrderSummary>>('/orders', { token: aliceToken });
    expect(mine.body.data.data).toHaveLength(1);
    expect(mine.body.data.data[0]).toMatchObject({
      id: orderId,
      status: 'PAID',
      total: 158_750,
      itemCount: 2,
    });
    expect(mine.body.data.meta).toMatchObject({ page: 1, total: 1, totalPages: 1 });

    const bobList = await call<Paginated<PublicOrderSummary>>('/orders', { token: bobToken });
    expect(bobList.body.data.data).toHaveLength(0);
    expect(bobList.body.data.meta.total).toBe(0);

    const bobRead = await call(`/orders/${orderId}`, { token: bobToken });
    expect(bobRead.status).toBe(404);
    expect(errorCode(bobRead)).toBe('ORDER_NOT_FOUND');
  });

  it('requires authentication', async () => {
    expect((await call('/orders')).status).toBe(401);
    expect((await call(`/orders/${crypto.randomUUID()}`)).status).toBe(401);
  });

  it('blocks customers from cancelling a paid order', async () => {
    const reference = await pay(aliceToken, aliceAddressId, 1);
    const placed = await call<PublicOrderDetail>('/orders', {
      token: aliceToken,
      body: { paymentReference: reference },
    });
    const res = await call(`/orders/${placed.body.data.id}/cancel`, {
      method: 'POST',
      token: aliceToken,
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('ORDER_INVALID_TRANSITION');

    // The state did not move.
    const [row] = await sql`SELECT status FROM orders WHERE id = ${placed.body.data.id}`;
    expect(row!.status).toBe('PAID');
    expect(await auditActions('order.cancelled')).toHaveLength(0);
  });
});

describe('bokku operations', () => {
  async function paidOrderId(quantity = 2): Promise<string> {
    const reference = await pay(aliceToken, aliceAddressId, quantity);
    const placed = await call<PublicOrderDetail>('/orders', {
      token: aliceToken,
      body: { paymentReference: reference },
    });
    return placed.body.data.id;
  }

  it('enforces RBAC and store-staff membership', async () => {
    const orderId = await paidOrderId();
    const asCustomer = await call(`/bokku/orders`, { token: customerToken });
    expect(asCustomer.status).toBe(403);
    expect(errorCode(asCustomer)).toBe('AUTH_ACCESS_DENIED');

    const asRogue = await call(`/bokku/orders/${orderId}/status`, {
      method: 'PATCH',
      token: rogueToken,
      body: { status: 'CONFIRMED' },
    });
    expect(asRogue.status).toBe(403);
    expect(errorCode(asRogue)).toBe('NOT_STORE_STAFF');
  });

  it('walks the staff progression and auto-dispatches at READY_FOR_PICKUP', async () => {
    const orderId = await paidOrderId();
    for (const status of ['CONFIRMED', 'PREPARING'] as const) {
      const res = await call<PublicOrderDetail>(`/bokku/orders/${orderId}/status`, {
        method: 'PATCH',
        token: managerToken,
        body: { status },
      });
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(status);
    }

    // Phase 9: READY_FOR_PICKUP immediately dispatches the courier — the
    // response shows the order already in DELIVERY_REQUESTED.
    const ready = await call<PublicOrderDetail>(`/bokku/orders/${orderId}/status`, {
      method: 'PATCH',
      token: managerToken,
      body: { status: 'READY_FOR_PICKUP' },
    });
    expect(ready.status).toBe(200);
    expect(ready.body.data.status).toBe('DELIVERY_REQUESTED');

    const changes = (await auditActions('order.status_changed')).map(
      (row) => row.metadata as { from: string; to: string },
    );
    expect(changes.map((c) => `${c.from}->${c.to}`)).toEqual([
      'PENDING_PAYMENT->PAID',
      'PAID->CONFIRMED',
      'CONFIRMED->PREPARING',
      'PREPARING->READY_FOR_PICKUP',
      'READY_FOR_PICKUP->DELIVERY_REQUESTED',
    ]);
    expect(await auditActions('delivery.dispatched')).toHaveLength(1);

    // The delivery row exists, tied one-to-one to the order.
    const rows = await sql`SELECT status, provider, external_id FROM deliveries`;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'REQUESTED', provider: 'MOCK' });
    expect(rows[0]!.external_id).toMatch(/^mockdel_/);
  });

  it('rejects skips, repeats, and refund statuses set directly', async () => {
    const orderId = await paidOrderId();

    const skip = await call(`/bokku/orders/${orderId}/status`, {
      method: 'PATCH',
      token: managerToken,
      body: { status: 'PREPARING' },
    });
    expect(skip.status).toBe(409);
    expect(errorCode(skip)).toBe('ORDER_INVALID_TRANSITION');

    const noop = await call(`/bokku/orders/${orderId}/status`, {
      method: 'PATCH',
      token: managerToken,
      body: { status: 'PAID' },
    });
    expect(noop.status).toBe(409);

    const refundDirect = await call(`/bokku/orders/${orderId}/status`, {
      method: 'PATCH',
      token: managerToken,
      body: { status: 'REFUNDED' },
    });
    expect(refundDirect.status).toBe(409);
    expect(errorCode(refundDirect)).toBe('ORDER_INVALID_TRANSITION');

    const deliveryEdge = await call(`/bokku/orders/${orderId}/status`, {
      method: 'PATCH',
      token: managerToken,
      body: { status: 'DELIVERED' },
    });
    expect(deliveryEdge.status).toBe(409); // delivery edges are SYSTEM-only
  });

  it('cancels with release, refund REFUND_PENDING → REFUNDED, and full audit trail', async () => {
    const orderId = await paidOrderId();
    const res = await call<PublicOrderDetail>(`/bokku/orders/${orderId}/status`, {
      method: 'PATCH',
      token: managerToken,
      body: { status: 'CANCELLED', reason: 'Substitution unavailable' },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REFUNDED');
    expect(res.body.data.cancelReason).toBe('Substitution unavailable');
    expect(res.body.data.cancelledAt).toBeTruthy();

    const [payment] = await sql`SELECT status FROM payments`;
    expect(payment!.status).toBe('REFUNDED');

    // Reservation released — all 10 units sellable again.
    expect((await inventoryRow()).reserved).toBe(0);
    expect((await inventoryRow()).on_hand).toBe(10);

    expect(await auditActions('order.cancelled')).toHaveLength(1);
    expect(await auditActions('payment.refunded')).toHaveLength(1);
    const changes = (await auditActions('order.status_changed')).map(
      (row) => row.metadata as { from: string; to: string },
    );
    expect(changes.map((c) => `${c.from}->${c.to}`)).toEqual([
      'PENDING_PAYMENT->PAID',
      'CANCELLED->REFUND_PENDING',
      'REFUND_PENDING->REFUNDED',
    ]);

    // Terminal — nothing moves it anymore.
    const stuck = await call(`/bokku/orders/${orderId}/status`, {
      method: 'PATCH',
      token: managerToken,
      body: { status: 'CONFIRMED' },
    });
    expect(stuck.status).toBe(409);
  });

  it('lists store orders with status filter and pagination meta', async () => {
    await paidOrderId();

    const paidList = await call<Paginated<PublicOrderSummary>>(
      '/bokku/orders?status=PAID&page=1&limit=5',
      { token: managerToken },
    );
    expect(paidList.body.data.data).toHaveLength(1);
    expect(paidList.body.data.meta).toMatchObject({ page: 1, limit: 5, total: 1 });

    const none = await call<Paginated<PublicOrderSummary>>('/bokku/orders?status=CONFIRMED', {
      token: managerToken,
    });
    expect(none.body.data.data).toHaveLength(0);
    expect(none.body.data.meta.total).toBe(0);

    const bogus = await call('/bokku/orders?status=MAYBE', { token: managerToken });
    expect(bogus.status).toBe(400);
  });

  it('scopes order detail to the store (404 for foreign order ids)', async () => {
    const orderId = await paidOrderId();
    const res = await call<PublicOrderDetail>(`/bokku/orders/${orderId}`, {
      token: managerToken,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(orderId);
    expect(res.body.data.items).toHaveLength(1);

    const other = await call(`/bokku/orders/${crypto.randomUUID()}`, { token: managerToken });
    expect(other.status).toBe(404);
    expect(errorCode(other)).toBe('ORDER_NOT_FOUND');
  });
});
