import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  ApiResponse,
  AuthResponse,
  InitializePaymentResult,
  PublicDeliveryTracking,
  PublicOrderDetail,
} from '@bokku/shared';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { TEST_DATABASE_URL } from './global-setup';

/**
 * Delivery dispatch + courier simulation journeys against real
 * PostgreSQL/Redis: auto-dispatch at READY_FOR_PICKUP, polling-driven
 * progression to DELIVERED with reservation settlement, tracking scopes,
 * dispatch retries, and courier cancellation semantics (early ok / late
 * refused). Tests fast-forward the mock by aging its Redis record.
 */

interface Envelope<T> {
  status: number;
  body: ApiResponse<T> & { data: T };
}

const TEST_REDIS_URL = 'redis://127.0.0.1:6379/1';
const MOCK_KEY_PREFIX = 'mockdel:';

let app: INestApplication;
let baseUrl: string;
let sql: postgres.Sql;
let redis: Redis;

let aliceToken: string;
let bobToken: string;
let managerToken: string;
let aliceAddressId: string;
let productA: string;

const password = 'Password123!';

async function call<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {},
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

/** Pay 2 × product A (stock 10) and return the fresh order's id. */
async function paidOrderId(quantity = 2): Promise<string> {
  await call('/cart/items', { token: aliceToken, body: { productId: productA, quantity } });
  const init = await call<InitializePaymentResult>('/payments/initialize', {
    token: aliceToken,
    body: { addressId: aliceAddressId },
  });
  const reference = init.body.data.reference;
  await call('/payments/mock/complete', { body: { reference, outcome: 'success' } });
  const placed = await call<PublicOrderDetail>('/orders', {
    token: aliceToken,
    body: { paymentReference: reference },
  });
  return placed.body.data.id;
}

async function staffTransition(orderId: string, status: string, reason?: string) {
  const res = await call<PublicOrderDetail>(`/bokku/orders/${orderId}/status`, {
    method: 'PATCH',
    token: managerToken,
    body: reason ? { status, reason } : { status },
  });
  return res;
}

/** Walk the order to READY_FOR_PICKUP; the courier dispatches automatically. */
async function dispatchedOrderId(): Promise<string> {
  const orderId = await paidOrderId();
  await staffTransition(orderId, 'CONFIRMED');
  await staffTransition(orderId, 'PREPARING');
  const ready = await staffTransition(orderId, 'READY_FOR_PICKUP');
  expect(ready.body.data.status).toBe('DELIVERY_REQUESTED');
  return orderId;
}

/** Age the mock courier record (tests control "time"). */
async function ageCourierBy(externalId: string, ms: number) {
  const raw = await redis.get(`${MOCK_KEY_PREFIX}${externalId}`);
  const record = JSON.parse(raw!) as { dispatchedAt: string };
  record.dispatchedAt = new Date(Date.now() - ms).toISOString();
  await redis.set(`${MOCK_KEY_PREFIX}${externalId}`, JSON.stringify(record));
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
  await sql`TRUNCATE users, stores, categories, products, product_images, inventory, store_staff, carts, cart_items, addresses, payments, orders, order_items, deliveries, audit_logs CASCADE`;
  await redis.flushdb();

  await createUser('alice@test.dev');
  await createUser('bob@test.dev');
  await createUser('manager@test.dev', 'STORE_MANAGER');

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

  const [manager] = await sql`SELECT id FROM users WHERE email = 'manager@test.dev'`;
  await sql`INSERT INTO store_staff (store_id, user_id) VALUES (${store!.id}, ${manager!.id})`;

  aliceToken = await login('alice@test.dev');
  bobToken = await login('bob@test.dev');
  managerToken = await login('manager@test.dev');

  const addr = await call<{ id: string }>('/addresses', {
    token: aliceToken,
    body: { label: 'Home', street: '24 Allen Avenue, Ikeja', city: 'Lagos', state: 'Lagos' },
  });
  aliceAddressId = addr.body.data.id;
});

afterAll(async () => {
  await app?.close();
  await sql?.end();
  redis?.disconnect();
});

describe('dispatch + full courier journey', () => {
  it('auto-dispatches at READY_FOR_PICKUP and delivers, settling stock', async () => {
    const orderId = await dispatchedOrderId();

    // Delivery row born at REQUESTED, one per order.
    const rows = await sql`
      SELECT status, provider, external_id, order_id FROM deliveries`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.order_id).toBe(orderId);
    expect(rows[0]!.status).toBe('REQUESTED');
    const externalId = rows[0]!.external_id;

    // Customer tracking: fresh dispatch has no courier yet.
    const fresh = await call<PublicDeliveryTracking>(`/orders/${orderId}/tracking`, {
      token: aliceToken,
    });
    expect(fresh.status).toBe(200);
    expect(fresh.body.data).toMatchObject({
      externalId,
      provider: 'MOCK',
      status: 'REQUESTED',
      courier: null,
    });
    expect(fresh.body.data.etaMinutes).toBeGreaterThan(0);
    expect(fresh.body.data.dispatchedAt).toBeTruthy();

    // Courier accepts → customer sees rider + order advances on read.
    await ageCourierBy(externalId, 11_000);
    const assigned = await call<PublicDeliveryTracking>(`/orders/${orderId}/tracking`, {
      token: aliceToken,
    });
    expect(assigned.body.data.status).toBe('DRIVER_ASSIGNED');
    expect(assigned.body.data.courier).toMatchObject({
      name: expect.any(String),
      phone: expect.stringMatching(/^\+234/),
    });
    let [orderRow] = await sql`SELECT status FROM orders WHERE id = ${orderId}`;
    expect(orderRow!.status).toBe('DRIVER_ASSIGNED');

    // On the road.
    await ageCourierBy(externalId, 61_000);
    const inTransit = await call<PublicDeliveryTracking>(`/orders/${orderId}/tracking`, {
      token: aliceToken,
    });
    expect(inTransit.body.data.status).toBe('IN_TRANSIT');
    [orderRow] = await sql`SELECT status FROM orders WHERE id = ${orderId}`;
    expect(orderRow!.status).toBe('OUT_FOR_DELIVERY');

    // Delivered — reservation settled: 10 → 8 on hand, 0 reserved.
    await ageCourierBy(externalId, 125_000);
    const delivered = await call<PublicDeliveryTracking>(`/orders/${orderId}/tracking`, {
      token: aliceToken,
    });
    expect(delivered.body.data.status).toBe('DELIVERED');
    expect(delivered.body.data.deliveredAt).toBeTruthy();
    [orderRow] = await sql`SELECT status, delivered_at FROM orders WHERE id = ${orderId}`;
    expect(orderRow!.status).toBe('DELIVERED');
    expect(orderRow!.delivered_at).not.toBeNull();
    expect(await inventoryRow()).toMatchObject({ on_hand: 8, reserved: 0 });

    // Every status change is audited, in order.
    const changes = (await auditActions('order.status_changed')).map(
      (r) => `${(r.metadata as { from: string }).from}->${(r.metadata as { to: string }).to}`,
    );
    expect(changes).toEqual([
      'PENDING_PAYMENT->PAID',
      'PAID->CONFIRMED',
      'CONFIRMED->PREPARING',
      'PREPARING->READY_FOR_PICKUP',
      'READY_FOR_PICKUP->DELIVERY_REQUESTED',
      'DELIVERY_REQUESTED->DRIVER_ASSIGNED',
      'DRIVER_ASSIGNED->OUT_FOR_DELIVERY',
      'OUT_FOR_DELIVERY->DELIVERED',
    ]);
  });

  it('scopes tracking to the owner and 404s pre-dispatch', async () => {
    const orderId = await paidOrderId();

    const notDispatched = await call(`/orders/${orderId}/tracking`, { token: aliceToken });
    expect(notDispatched.status).toBe(404);
    expect(errorCode(notDispatched)).toBe('DELIVERY_NOT_FOUND');

    await staffTransition(orderId, 'CONFIRMED');
    await staffTransition(orderId, 'PREPARING');
    await staffTransition(orderId, 'READY_FOR_PICKUP');

    const asBob = await call(`/orders/${orderId}/tracking`, { token: bobToken });
    expect(asBob.status).toBe(404);
    expect(errorCode(asBob)).toBe('ORDER_NOT_FOUND');

    expect((await call(`/orders/${orderId}/tracking`)).status).toBe(401);

    // Staff tracking is store-scoped and works.
    const staff = await call<PublicDeliveryTracking>(`/bokku/orders/${orderId}/tracking`, {
      token: managerToken,
    });
    expect(staff.status).toBe(200);
    expect(staff.body.data.status).toBe('REQUESTED');
  });
});

describe('manual dispatch endpoint', () => {
  it('rejects dispatch before the order is ready, replays idempotently after', async () => {
    const orderId = await paidOrderId();
    const early = await call(`/bokku/orders/${orderId}/dispatch`, {
      method: 'POST',
      token: managerToken,
    });
    expect(early.status).toBe(409);
    expect(errorCode(early)).toBe('DELIVERY_NOT_DISPATCHABLE');

    await staffTransition(orderId, 'CONFIRMED');
    await staffTransition(orderId, 'PREPARING');
    await staffTransition(orderId, 'READY_FOR_PICKUP'); // auto-dispatched here

    const first = await call<PublicDeliveryTracking>(`/bokku/orders/${orderId}/dispatch`, {
      method: 'POST',
      token: managerToken,
    });
    const second = await call<PublicDeliveryTracking>(`/bokku/orders/${orderId}/dispatch`, {
      method: 'POST',
      token: managerToken,
    });
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(second.body.data.externalId).toBe(first.body.data.externalId);

    const count = await sql`SELECT count(*)::int AS n FROM deliveries`;
    expect(count[0]!.n).toBe(1);
    expect(await auditActions('delivery.dispatched')).toHaveLength(1);

    const unknown = await call(`/bokku/orders/${crypto.randomUUID()}/dispatch`, {
      method: 'POST',
      token: managerToken,
    });
    expect(unknown.status).toBe(404);
  });
});

describe('courier cancellation semantics', () => {
  it('cancels the courier, then the order — refund path intact', async () => {
    const orderId = await dispatchedOrderId();

    const cancelled = await staffTransition(orderId, 'CANCELLED', 'Item unavailable');
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.status).toBe('REFUNDED');

    const [delivery] = await sql`
      SELECT status, cancelled_at, cancel_reason FROM deliveries WHERE order_id = ${orderId}`;
    expect(delivery).toMatchObject({ status: 'CANCELLED', cancel_reason: 'Item unavailable' });
    expect(delivery!.cancelled_at).not.toBeNull();

    const [payment] = await sql`SELECT status FROM payments`;
    expect(payment!.status).toBe('REFUNDED');
    expect(await inventoryRow()).toMatchObject({ on_hand: 10, reserved: 0 });
    expect(await auditActions('delivery.cancelled')).toHaveLength(1);
  });

  it('refuses cancellation once the courier is at the store (409)', async () => {
    const orderId = await dispatchedOrderId();
    const [delivery] = await sql`SELECT external_id FROM deliveries WHERE order_id = ${orderId}`;
    await ageCourierBy(delivery!.external_id, 31_000); // DRIVER_ARRIVING

    const refused = await staffTransition(orderId, 'CANCELLED', 'try anyway');
    expect(refused.status).toBe(409);
    expect(errorCode(refused)).toBe('DELIVERY_NOT_CANCELLABLE');

    // The order is untouched; a tracking sync advances it order-side.
    const [row] = await sql`SELECT status FROM orders WHERE id = ${orderId}`;
    expect(row!.status).toBe('DELIVERY_REQUESTED');
    const tracking = await call<PublicDeliveryTracking>(`/orders/${orderId}/tracking`, {
      token: aliceToken,
    });
    expect(tracking.body.data.status).toBe('DRIVER_ARRIVING');
    const [after] = await sql`SELECT status FROM orders WHERE id = ${orderId}`;
    expect(after!.status).toBe('DRIVER_ASSIGNED');
  });
});
