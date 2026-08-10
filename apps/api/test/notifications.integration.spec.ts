import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  ApiResponse,
  AuthResponse,
  InitializePaymentResult,
  NotificationUnreadCount,
  Paginated,
  PublicNotification,
  PublicNotificationPreferences,
  PublicOrderDetail,
} from '@bokku/shared';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { TEST_DATABASE_URL } from './global-setup';

/**
 * Notification feed journeys against real PostgreSQL/Redis: the full
 * order→delivery lifecycle lands the expected events in each audience's
 * feed; preferences gate categories; read endpoints are owner-scoped and
 * idempotent. Tests fast-forward the mock courier by aging its record.
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
let aliceId: string;
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

async function feed(token: string, query = 'limit=50') {
  const res = await call<Paginated<PublicNotification>>(`/notifications?${query}`, { token });
  return res.body.data;
}

async function types(token: string): Promise<string[]> {
  return (await feed(token)).data.map((n) => n.type);
}

/** Pay 2 × product A and place the order; returns the fresh order id. */
async function paidOrderId(token: string, addressId: string): Promise<string> {
  await call('/cart/items', { token, body: { productId: productA, quantity: 2 } });
  const init = await call<InitializePaymentResult>('/payments/initialize', {
    token,
    body: { addressId },
  });
  const reference = init.body.data.reference;
  await call('/payments/mock/complete', { body: { reference, outcome: 'success' } });
  const placed = await call<PublicOrderDetail>('/orders', {
    token,
    body: { paymentReference: reference },
  });
  return placed.body.data.id;
}

async function staffTransition(orderId: string, status: string) {
  return call<PublicOrderDetail>(`/bokku/orders/${orderId}/status`, {
    method: 'PATCH',
    token: managerToken,
    body: { status },
  });
}

async function ageCourierBy(externalId: string, ms: number) {
  const raw = await redis.get(`${MOCK_KEY_PREFIX}${externalId}`);
  const record = JSON.parse(raw!) as { dispatchedAt: string };
  record.dispatchedAt = new Date(Date.now() - ms).toISOString();
  await redis.set(`${MOCK_KEY_PREFIX}${externalId}`, JSON.stringify(record));
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
  await sql`TRUNCATE users, stores, categories, products, product_images, inventory, store_staff, carts, cart_items, addresses, payments, orders, order_items, deliveries, audit_logs, notifications, notification_preferences CASCADE`;
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
    VALUES (${store!.id}, ${productA}, 50)`;

  const [manager] = await sql`SELECT id FROM users WHERE email = 'manager@test.dev'`;
  await sql`INSERT INTO store_staff (store_id, user_id) VALUES (${store!.id}, ${manager!.id})`;
  const [alice] = await sql`SELECT id FROM users WHERE email = 'alice@test.dev'`;
  aliceId = alice!.id;

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

describe('lifecycle emissions', () => {
  it('the full order journey lands the right events for customer + staff', async () => {
    const orderId = await paidOrderId(aliceToken, aliceAddressId);

    // Payment conversion → customer + staff feeds.
    expect(await types(aliceToken)).toEqual(['order.paid']);
    expect(await types(managerToken)).toEqual(['store.order_new']);
    expect(await types(bobToken)).toEqual([]); // bystanders get nothing

    await staffTransition(orderId, 'CONFIRMED');
    await staffTransition(orderId, 'PREPARING');
    await staffTransition(orderId, 'READY_FOR_PICKUP'); // auto-dispatch

    let aliceTypes = await types(aliceToken);
    expect(aliceTypes.slice(0, 4)).toEqual([
      'delivery.dispatched',
      'order.status_changed',
      'order.status_changed',
      'order.status_changed',
    ]);

    // Age the mock courier past DELIVERED and sync via a tracking read.
    const [delivery] = await sql`SELECT external_id FROM deliveries WHERE order_id = ${orderId}`;
    await ageCourierBy(delivery!.external_id, 130_000);
    await call(`/orders/${orderId}/tracking`, { token: aliceToken });

    aliceTypes = await types(aliceToken);
    expect(aliceTypes.slice(0, 3)).toEqual([
      'delivery.delivered',
      'delivery.out_for_delivery',
      'delivery.driver_assigned',
    ]);

    // Deep-link metadata travels with every event.
    const feedRows = (await feed(aliceToken)).data;
    expect(feedRows.every((n) => n.data?.['orderId'] === orderId)).toBe(true);
    const assigned = feedRows.find((n) => n.type === 'delivery.driver_assigned')!;
    expect(assigned.data?.['courier']).toMatchObject({ name: expect.any(String) });
  });

  it('the refund path notifies cancellation and refund completion', async () => {
    const orderId = await paidOrderId(aliceToken, aliceAddressId);
    await staffTransition(orderId, 'CONFIRMED');
    await call<PublicOrderDetail>(`/bokku/orders/${orderId}/status`, {
      method: 'PATCH',
      token: managerToken,
      body: { status: 'CANCELLED', reason: 'item unavailable' },
    });

    const aliceTypes = await types(aliceToken);
    expect(aliceTypes.slice(0, 2)).toEqual(['payment.refunded', 'order.cancelled']);
    const cancelled = (await feed(aliceToken)).data.find((n) => n.type === 'order.cancelled')!;
    expect(cancelled.body).toContain('item unavailable');
  });
});

describe('preferences gating', () => {
  it('muted categories are suppressed; others still land', async () => {
    // Defaults materialise lazily on first read.
    const prefs = await call('/notifications/preferences', { token: aliceToken });
    expect(prefs.body.data).toMatchObject({
      orderUpdates: true,
      paymentUpdates: true,
      deliveryUpdates: true,
      marketing: false,
      emailEnabled: false,
      smsEnabled: false,
    });

    const patched = await call<PublicNotificationPreferences>('/notifications/preferences', {
      method: 'PATCH',
      token: aliceToken,
      body: { deliveryUpdates: false, smsEnabled: true },
    });
    expect(patched.body.data.deliveryUpdates).toBe(false);
    expect(patched.body.data.smsEnabled).toBe(true);
    expect(patched.body.data.orderUpdates).toBe(true); // merge, not replace

    const orderId = await paidOrderId(aliceToken, aliceAddressId);
    await staffTransition(orderId, 'CONFIRMED');
    await staffTransition(orderId, 'PREPARING');
    await staffTransition(orderId, 'READY_FOR_PICKUP'); // dispatch suppressed…

    const aliceTypes = await types(aliceToken);
    expect(aliceTypes).not.toContain('delivery.dispatched');
    expect(aliceTypes).toContain('order.paid');
    expect(aliceTypes).toContain('order.status_changed');

    // …even as the courier progresses.
    const [delivery] = await sql`SELECT external_id FROM deliveries WHERE order_id = ${orderId}`;
    await ageCourierBy(delivery!.external_id, 130_000);
    await call(`/orders/${orderId}/tracking`, { token: aliceToken });
    expect((await types(aliceToken)).some((t) => t.startsWith('delivery.'))).toBe(false);

    // The global ValidationPipe runs with enableImplicitConversion (app.setup.ts),
    // so a primitive 'yes' is coerced to `true` by class-transformer before
    // @IsBoolean() runs — matching every other boolean DTO in the platform.
    // What the pipe DOES guarantee is rejecting unknown keys (forbidNonWhitelisted).
    const coerced = await call<PublicNotificationPreferences>('/notifications/preferences', {
      method: 'PATCH',
      token: aliceToken,
      body: { orderUpdates: 'yes' },
    });
    expect(coerced.status).toBe(200);
    expect(coerced.body.data.orderUpdates).toBe(true);

    expect(
      (
        await call('/notifications/preferences', {
          method: 'PATCH',
          token: aliceToken,
          body: { nonsense: true },
        })
      ).status,
    ).toBe(400);
  });

  it('muting orderUpdates also suppresses the staff fan-out for that member', async () => {
    await call('/notifications/preferences', {
      method: 'PATCH',
      token: managerToken,
      body: { orderUpdates: false },
    });
    await paidOrderId(aliceToken, aliceAddressId);
    expect(await types(managerToken)).toEqual([]);
  });
});

describe('read state', () => {
  it('mark-read is idempotent and owner-scoped; read-all drains the feed', async () => {
    await paidOrderId(aliceToken, aliceAddressId);
    await staffTransition(await paidOrderId(aliceToken, aliceAddressId), 'CONFIRMED');

    const before = await call<NotificationUnreadCount>('/notifications/unread-count', {
      token: aliceToken,
    });
    expect(before.body.data.unread).toBe(3); // 2 × order.paid + 1 status change

    const [first] = (await feed(aliceToken)).data;
    const read = await call<PublicNotification>(`/notifications/${first!.id}/read`, {
      method: 'PATCH',
      token: aliceToken,
    });
    expect(read.body.data.readAt).not.toBeNull();

    // Second read: idempotent 200 with the same timestamp.
    const again = await call<PublicNotification>(`/notifications/${first!.id}/read`, {
      method: 'PATCH',
      token: aliceToken,
    });
    expect(again.status).toBe(200);
    expect(again.body.data.readAt).toBe(read.body.data.readAt);

    // Bob touching Alice's row: clean 404 (no cross-account reads).
    const foreign = await call<PublicNotification>(`/notifications/${first!.id}/read`, {
      method: 'PATCH',
      token: bobToken,
    });
    expect(foreign.status).toBe(404);
    expect(errorCode(foreign)).toBe('NOTIFICATION_NOT_FOUND');

    // Unread-only slice shrinks accordingly.
    expect((await feed(aliceToken, 'unread=true')).meta.total).toBe(2);

    const drained = await call<{ updated: number }>('/notifications/read-all', {
      method: 'POST',
      token: aliceToken,
    });
    expect(drained.body.data.updated).toBe(2);
    expect(
      (await call<NotificationUnreadCount>('/notifications/unread-count', { token: aliceToken }))
        .body.data.unread,
    ).toBe(0);
    expect(
      (
        await call<{ updated: number }>('/notifications/read-all', {
          method: 'POST',
          token: aliceToken,
        })
      ).body.data.updated,
    ).toBe(0);
  });

  it('requires auth on every route', async () => {
    expect((await call('/notifications')).status).toBe(401);
    expect((await call('/notifications/unread-count')).status).toBe(401);
    expect((await call('/notifications/preferences')).status).toBe(401);
    expect(
      (
        await call(`/notifications/${aliceId}/read`, {
          method: 'PATCH',
        })
      ).status,
    ).toBe(401);
  });
});
