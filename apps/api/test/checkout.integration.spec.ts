import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApiResponse, AuthResponse, CheckoutPreview, PublicAddress } from '@bokku/shared';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { TEST_DATABASE_URL } from './global-setup';

/** Addresses + checkout preview against real PostgreSQL. */
interface Envelope<T> {
  status: number;
  body: ApiResponse<T> & { data: T };
}

const STORE_LAT = 6.5926;
const STORE_LNG = 3.2907;

let app: INestApplication;
let baseUrl: string;
let sql: postgres.Sql;
let storeId: string;
let productA: string;
let aliceToken: string;
let bobToken: string;

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

function mkAddress(overrides: Record<string, unknown> = {}) {
  return {
    label: 'Home',
    street: '24 Allen Avenue, Ikeja',
    city: 'Lagos',
    state: 'Lagos',
    ...overrides,
  };
}

function mkDeliveryAddress(overrides: Record<string, unknown> = {}) {
  return mkAddress({ latitude: STORE_LAT, longitude: STORE_LNG, ...overrides });
}

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.NODE_ENV = 'test';
  sql = postgres(TEST_DATABASE_URL, { max: 3 });
  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0);
  const address = app.getHttpServer().address();
  if (typeof address === 'string' || !address) throw new Error('no address');
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
}, 60_000);

beforeEach(async () => {
  await sql`TRUNCATE users, stores, categories, products, product_images, inventory, store_staff, carts, cart_items, addresses CASCADE`;
  for (const email of ['alice@test.dev', 'bob@test.dev']) {
    await call('/auth/register', { body: { email, password, firstName: 'T', lastName: 'U' } });
  }
  aliceToken = await login('alice@test.dev');
  bobToken = await login('bob@test.dev');

  const [store] = await sql`
    INSERT INTO stores (name, code, address, city, state, latitude, longitude)
    VALUES ('Bokku', 'BOKKU', '12 Market Street', 'Lagos', 'Lagos', ${STORE_LAT}, ${STORE_LNG})
    RETURNING id`;
  storeId = store!.id;
  const [category] = await sql`
    INSERT INTO categories (store_id, name, slug) VALUES (${storeId}, 'Food', 'food') RETURNING id`;
  const [product] = await sql`
    INSERT INTO products (store_id, category_id, name, slug, sku, price, status)
    VALUES (${storeId}, ${category!.id}, 'Product A', 'product-a', 'SKU-A', 15_000, 'ACTIVE')
    RETURNING id`;
  productA = product!.id;
  await sql`INSERT INTO inventory (store_id, product_id, quantity_on_hand) VALUES (${storeId}, ${productA}, 10)`;
});

afterAll(async () => {
  await app?.close();
  await sql?.end();
});

describe('addresses', () => {
  it('requires authentication', async () => {
    expect((await call('/addresses')).status).toBe(401);
  });

  it('validates payload shape and coordinate pairs', async () => {
    const missingStreet = await call('/addresses', {
      token: aliceToken,
      body: { city: 'Lagos', state: 'Lagos' },
    });
    expect(missingStreet.status).toBe(400);

    const halfPair = await call('/addresses', {
      token: aliceToken,
      body: mkAddress({ latitude: 6.5 }),
    });
    expect(halfPair.status).toBe(400);
    expect(errorCode(halfPair)).toBe('COORDINATE_PAIR_REQUIRED');
  });

  it('allows an address without coordinates for address-book use', async () => {
    const res = await call<PublicAddress>('/addresses', { token: aliceToken, body: mkAddress() });
    expect(res.status).toBe(201);
    expect(res.body.data.latitude).toBeNull();
    expect(res.body.data.longitude).toBeNull();
  });

  it('makes the first address default automatically', async () => {
    const first = await call<PublicAddress>('/addresses', { token: aliceToken, body: mkAddress() });
    expect(first.status).toBe(201);
    expect(first.body.data.isDefault).toBe(true);
    const second = await call<PublicAddress>('/addresses', {
      token: aliceToken,
      body: mkAddress({ label: 'Office' }),
    });
    expect(second.body.data.isDefault).toBe(false);
  });

  it('switches the single default atomically', async () => {
    await call('/addresses', { token: aliceToken, body: mkAddress({ label: 'Home' }) });
    const office = await call<PublicAddress>('/addresses', {
      token: aliceToken,
      body: mkAddress({ label: 'Office', isDefault: true }),
    });
    expect(office.body.data.isDefault).toBe(true);
    const list = await call<PublicAddress[]>('/addresses', { token: aliceToken });
    expect(list.body.data.filter((a) => a.isDefault)).toHaveLength(1);
    const home = list.body.data.find((a) => a.label === 'Home')!;
    await call(`/addresses/${home.id}`, { method: 'PATCH', token: aliceToken, body: { isDefault: true } });
    const after = await call<PublicAddress[]>('/addresses', { token: aliceToken });
    expect(after.body.data.filter((a) => a.isDefault)).toHaveLength(1);
    expect(after.body.data.find((a) => a.label === 'Home')?.isDefault).toBe(true);
  });

  it('rejects location text changes without new coordinates', async () => {
    const created = await call<PublicAddress>('/addresses', {
      token: aliceToken,
      body: mkDeliveryAddress(),
    });
    const res = await call(`/addresses/${created.body.data.id}`, {
      method: 'PATCH',
      token: aliceToken,
      body: { street: '10 Adeola Odeku' },
    });
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('LOCATION_COORDINATES_REQUIRED');
  });

  it('updates the physical location when a new coordinate pair is supplied', async () => {
    const created = await call<PublicAddress>('/addresses', {
      token: aliceToken,
      body: mkDeliveryAddress(),
    });
    const res = await call<PublicAddress>(`/addresses/${created.body.data.id}`, {
      method: 'PATCH',
      token: aliceToken,
      body: { street: '10 Adeola Odeku', latitude: 6.4302, longitude: 3.4207 },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.street).toBe('10 Adeola Odeku');
    expect(res.body.data.latitude).toBeCloseTo(6.4302);
    expect(res.body.data.longitude).toBeCloseTo(3.4207);
  });

  it('scopes every operation to the owner (no IDOR)', async () => {
    const mine = await call<PublicAddress>('/addresses', { token: aliceToken, body: mkAddress() });
    const id = mine.body.data.id;
    expect((await call<PublicAddress[]>('/addresses', { token: bobToken })).body.data).toHaveLength(0);
    const patched = await call(`/addresses/${id}`, { method: 'PATCH', token: bobToken, body: { label: 'hijack' } });
    expect(patched.status).toBe(404);
    expect(errorCode(patched)).toBe('ADDRESS_NOT_FOUND');
    expect((await call(`/addresses/${id}`, { method: 'DELETE', token: bobToken })).status).toBe(404);
  });

  it('promotes the most recent address when the default is deleted', async () => {
    await call('/addresses', { token: aliceToken, body: mkAddress({ label: 'First' }) });
    const second = await call<PublicAddress>('/addresses', {
      token: aliceToken,
      body: mkAddress({ label: 'Second', isDefault: true }),
    });
    await call(`/addresses/${second.body.data.id}`, { method: 'DELETE', token: aliceToken });
    const list = await call<PublicAddress[]>('/addresses', { token: aliceToken });
    expect(list.body.data[0]).toMatchObject({ label: 'First', isDefault: true });
  });

  it('caps saved addresses at 10 per user', async () => {
    for (let i = 1; i <= 10; i++) {
      const res = await call('/addresses', { token: aliceToken, body: mkAddress({ label: `A${i}` }) });
      expect(res.status).toBe(201);
    }
    const eleventh = await call('/addresses', { token: aliceToken, body: mkAddress({ label: 'A11' }) });
    expect(eleventh.status).toBe(409);
    expect(errorCode(eleventh)).toBe('ADDRESS_LIMIT_REACHED');
  });
});

describe('checkout preview', () => {
  async function createAliceAddress(body: Record<string, unknown> = {}): Promise<string> {
    const res = await call<PublicAddress>('/addresses', { token: aliceToken, body: mkDeliveryAddress(body) });
    return res.body.data.id;
  }

  it('rejects an empty cart', async () => {
    const addressId = await createAliceAddress();
    const res = await call('/checkout/preview', { token: aliceToken, body: { addressId } });
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('CART_EMPTY');
  });

  it('rejects an address without delivery coordinates', async () => {
    const address = await call<PublicAddress>('/addresses', { token: aliceToken, body: mkAddress() });
    await call('/cart/items', { token: aliceToken, body: { productId: productA, quantity: 1 } });
    const res = await call('/checkout/preview', { token: aliceToken, body: { addressId: address.body.data.id } });
    expect(res.status).toBe(400);
    expect(errorCode(res)).toBe('DELIVERY_COORDINATES_REQUIRED');
  });

  it('rejects another user’s address id (no IDOR)', async () => {
    const bobAddress = await call<PublicAddress>('/addresses', { token: bobToken, body: mkDeliveryAddress() });
    await call('/cart/items', { token: aliceToken, body: { productId: productA, quantity: 1 } });
    const res = await call('/checkout/preview', { token: aliceToken, body: { addressId: bobAddress.body.data.id } });
    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('ADDRESS_NOT_FOUND');
  });

  it('rejects carts with lines that are no longer fulfillable', async () => {
    const addressId = await createAliceAddress();
    await call('/cart/items', { token: aliceToken, body: { productId: productA, quantity: 3 } });
    await sql`UPDATE inventory SET quantity_on_hand = 2 WHERE product_id = ${productA}`;
    const res = await call('/checkout/preview', { token: aliceToken, body: { addressId } });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('CART_ITEMS_UNAVAILABLE');
  });

  it('computes the full breakdown from real coordinates', async () => {
    const addressId = await createAliceAddress();
    await call('/cart/items', { token: aliceToken, body: { productId: productA, quantity: 2 } });
    const res = await call<CheckoutPreview>('/checkout/preview', { token: aliceToken, body: { addressId } });
    expect(res.status).toBe(201);
    const preview = res.body.data;
    expect(preview.lines).toEqual([expect.objectContaining({ productId: productA, unitPrice: 15_000, quantity: 2, lineTotal: 30_000 })]);
    expect(preview.quote.provider).toBe('MOCK');
    expect(preview.quote.fee).toBe(50_000);
    expect(preview.quote.distanceKm).toBe(0);
    expect(preview.quote.estimatedMinutes).toBe(15);
    expect(preview.quote.quoteId).toMatch(/^mockq_/);
    expect(Date.parse(preview.quote.expiresAt)).toBeGreaterThan(Date.now());
    expect(preview).toMatchObject({ subtotal: 30_000, deliveryFee: 50_000, serviceFee: 1_500, tax: 2_250, discount: 0, total: 83_750 });
  });

  it('uses real coordinates for a non-zero delivery quote', async () => {
    const addressId = await createAliceAddress({ latitude: 6.4302, longitude: 3.4207 });
    await call('/cart/items', { token: aliceToken, body: { productId: productA, quantity: 1 } });
    const res = await call<CheckoutPreview>('/checkout/preview', { token: aliceToken, body: { addressId } });
    expect(res.status).toBe(201);
    expect(res.body.data.quote.distanceKm).toBeGreaterThan(0);
    expect(res.body.data.quote.fee).toBeGreaterThan(50_000);
  });
});
