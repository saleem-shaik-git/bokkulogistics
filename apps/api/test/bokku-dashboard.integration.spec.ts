import { randomBytes } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Redis } from 'ioredis';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApiResponse, AuthResponse, OpsDashboardSummary, OrderStatus } from '@bokku/shared';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { TEST_DATABASE_URL } from './global-setup';

/**
 * Ops dashboard aggregates and staff gates: today counts/revenue semantics
 * (UTC day, collected-and-not-refunded), per-status tallies alongside the
 * fulfillment queue, and low-stock/out-of-stock alerting. Orders are seeded
 * straight as rows (their lifecycle is covered by the orders spec).
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

let managerToken: string;
let customerToken: string;
let rogueToken: string;
let platformToken: string;
let storeId: string;
let customerId: string;
let cartId: string;

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

/** Insert a payment + order pair directly (lifecycle tested elsewhere). */
async function seedOrder(input: {
  status: OrderStatus;
  total: number;
  createdAt: Date;
  paidAt: Date | null;
}) {
  const reference = `bokku_pay_${randomBytes(16).toString('hex')}`;
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  const [payment] = await sql`
    INSERT INTO payments (user_id, cart_id, store_id, reference, provider, status, amount, email, paid_at)
    VALUES (${customerId}, ${cartId}, ${storeId}, ${reference}, 'MOCK',
            ${input.paidAt ? 'SUCCESS' : 'PENDING'}, ${input.total}, 'seed@test.dev', ${input.paidAt})
    RETURNING id`;
  await sql`
    INSERT INTO orders (order_number, user_id, store_id, payment_id, status,
                        subtotal, delivery_fee, service_fee, tax, total,
                        delivery_address, delivery_quote, created_at, paid_at)
    VALUES (${`BK-T-${suffix}`}, ${customerId}, ${storeId}, ${payment!.id}, ${input.status},
            ${input.total}, 0, 0, 0, ${input.total},
            '{"label":"T"}', '{"quoteId":"q"}', ${input.createdAt}, ${input.paidAt})`;
}

/** UTC midnight today, mirroring the service's documented day boundary. */
function startOfUtcToday(): number {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime();
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

  await createUser('customer@test.dev');
  await createUser('manager@test.dev', 'STORE_MANAGER');
  await createUser('rogue@test.dev', 'STORE_MANAGER'); // no staff link
  await createUser('platform@test.dev', 'PLATFORM_ADMIN'); // guard bypass, no staff link

  const [store] = await sql`
    INSERT INTO stores (name, code, address, city, state)
    VALUES ('Bokku', 'BOKKU', '12 Market Street', 'Lagos', 'Lagos') RETURNING id`;
  storeId = store!.id;
  const [category] = await sql`
    INSERT INTO categories (store_id, name, slug) VALUES (${storeId}, 'Food', 'food') RETURNING id`;

  // Healthy, out-of-stock, low-stock — one of each.
  const seeds = [
    { name: 'Healthy A', slug: 'healthy-a', sku: 'SKU-A', onHand: 10, threshold: 5 },
    { name: 'Empty B', slug: 'empty-b', sku: 'SKU-B', onHand: 0, threshold: 5 },
    { name: 'Low C', slug: 'low-c', sku: 'SKU-C', onHand: 3, threshold: 5 },
  ] as const;
  for (const p of seeds) {
    const [product] = await sql`
      INSERT INTO products (store_id, category_id, name, slug, sku, price, status, low_stock_threshold)
      VALUES (${storeId}, ${category!.id}, ${p.name}, ${p.slug}, ${p.sku}, 15_000, 'ACTIVE', ${p.threshold})
      RETURNING id`;
    await sql`
      INSERT INTO inventory (store_id, product_id, quantity_on_hand)
      VALUES (${storeId}, ${product!.id}, ${p.onHand})`;
  }

  const [manager] = await sql`SELECT id FROM users WHERE email = 'manager@test.dev'`;
  await sql`INSERT INTO store_staff (store_id, user_id) VALUES (${storeId}, ${manager!.id})`;

  const [customer] = await sql`SELECT id FROM users WHERE email = 'customer@test.dev'`;
  customerId = customer!.id;
  const [cart] =
    await sql`INSERT INTO carts (user_id, store_id) VALUES (${customerId}, ${storeId}) RETURNING id`;
  cartId = cart!.id;

  managerToken = await login('manager@test.dev');
  customerToken = await login('customer@test.dev');
  rogueToken = await login('rogue@test.dev');
  platformToken = await login('platform@test.dev');
});

afterAll(async () => {
  await app?.close();
  await sql?.end();
  redis?.disconnect();
});

describe('staff gates', () => {
  it('requires authentication and staff membership', async () => {
    expect((await call('/bokku/dashboard')).status).toBe(401);

    const asCustomer = await call('/bokku/dashboard', { token: customerToken });
    expect(asCustomer.status).toBe(403);
    expect(errorCode(asCustomer)).toBe('AUTH_ACCESS_DENIED');

    const asRogue = await call('/bokku/dashboard', { token: rogueToken });
    expect(asRogue.status).toBe(403);
    expect(errorCode(asRogue)).toBe('NOT_STORE_STAFF');
  });

  it('allows a platform admin without store membership (support access)', async () => {
    const res = await call<OpsDashboardSummary>('/bokku/dashboard', { token: platformToken });
    expect(res.status).toBe(200);
    expect(res.body.data.store.code).toBe('BOKKU');
  });
});

describe('aggregates', () => {
  it('computes today counts, revenue semantics, the queue, and stock alerts', async () => {
    // "Today" as the service sees it; clamp to stay inside the UTC day even
    // in the first minute after midnight.
    const today = new Date(Math.max(Date.now(), startOfUtcToday() + 60_000));
    const yesterday = new Date(today.getTime() - 25 * 3_600_000);

    await seedOrder({ status: 'PAID', total: 1_000, createdAt: today, paidAt: today });
    await seedOrder({ status: 'PAID', total: 2_500, createdAt: today, paidAt: today });
    await seedOrder({ status: 'PREPARING', total: 4_000, createdAt: today, paidAt: today });
    await seedOrder({
      status: 'OUT_FOR_DELIVERY',
      total: 3_000,
      createdAt: today,
      paidAt: today,
    });
    // Not revenue: refunded today, cancelled today, paid yesterday.
    await seedOrder({ status: 'REFUNDED', total: 800, createdAt: today, paidAt: today });
    await seedOrder({ status: 'CANCELLED', total: 700, createdAt: today, paidAt: null });
    await seedOrder({ status: 'DELIVERED', total: 9_999, createdAt: yesterday, paidAt: yesterday });

    const res = await call<OpsDashboardSummary>('/bokku/dashboard', { token: managerToken });
    expect(res.status).toBe(200);
    const d = res.body.data;

    expect(d.store).toMatchObject({ id: storeId, code: 'BOKKU' });
    expect(d.todayOrders).toBe(6); // all except yesterday's DELIVERED
    expect(d.todayRevenue).toBe(10_500); // 1000+2500+4000+3000
    expect(d.pendingFulfillment).toBe(4); // 2×PAID + PREPARING + OUT_FOR_DELIVERY
    expect(d.outForDelivery).toBe(1);
    expect(d.ordersByStatus).toEqual({
      PAID: 2,
      PREPARING: 1,
      OUT_FOR_DELIVERY: 1,
      REFUNDED: 1,
      CANCELLED: 1,
      DELIVERED: 1,
    });

    expect(d.lowStockCount).toBe(1); // Low C (Empty B counts under out-of-stock)
    expect(d.outOfStockCount).toBe(1);
    expect(d.lowStockAlerts.map((a) => a.sku)).toEqual(['SKU-B', 'SKU-C']); // worst first
    expect(d.lowStockAlerts[0]).toMatchObject({ sellable: 0, lowStock: true });
  });

  it('reports an empty store day without nulls', async () => {
    const res = await call<OpsDashboardSummary>('/bokku/dashboard', { token: managerToken });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      todayOrders: 0,
      todayRevenue: 0,
      pendingFulfillment: 0,
      outForDelivery: 0,
      ordersByStatus: {},
    });
  });
});
