import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { ApiResponse, AuthResponse, PublicCart } from '@bokku/shared';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { TEST_DATABASE_URL } from './global-setup';

/**
 * Cart journeys against real PostgreSQL: auth required, server-side price
 * authority, availability/stock guard rails, single-store carts,
 * owner-scoped line operations (no IDOR) and live price reads.
 */

interface Envelope<T> {
  status: number;
  body: ApiResponse<T> & { data: T };
}

let app: INestApplication;
let baseUrl: string;
let sql: postgres.Sql;

let storeId: string;
let categoryId: string;
/** price 15_000 kobo, stock 5 */
let productA: string;
/** price 500 kobo, stock 0 */
let productB: string;
/** price 2_000 kobo, stock 10, status DRAFT */
let productC: string;

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
  await sql`TRUNCATE users, stores, categories, products, product_images, inventory, store_staff, carts, cart_items CASCADE`;

  await call('/auth/register', {
    body: { email: 'alice@test.dev', password, firstName: 'Alice', lastName: 'A' },
  });
  await call('/auth/register', {
    body: { email: 'bob@test.dev', password, firstName: 'Bob', lastName: 'B' },
  });
  aliceToken = await login('alice@test.dev');
  bobToken = await login('bob@test.dev');

  const [store] = await sql`
    INSERT INTO stores (name, code, address, city, state)
    VALUES ('Bokku', 'BOKKU', '12 Market Street', 'Lagos', 'Lagos') RETURNING id`;
  storeId = store!.id;

  const [category] = await sql`
    INSERT INTO categories (store_id, name, slug) VALUES (${storeId}, 'Food', 'food') RETURNING id`;
  categoryId = category!.id;

  async function seedProduct(name: string, price: number, stock: number, status = 'ACTIVE') {
    const [product] = await sql`
      INSERT INTO products (store_id, category_id, name, slug, sku, price, status)
      VALUES (${storeId}, ${categoryId}, ${name}, ${name.toLowerCase().replaceAll(' ', '-')}, ${name}, ${price}, ${status})
      RETURNING id`;
    await sql`
      INSERT INTO inventory (store_id, product_id, quantity_on_hand)
      VALUES (${storeId}, ${product!.id}, ${stock})`;
    return product!.id as string;
  }

  productA = await seedProduct('Product A', 15_000, 5);
  productB = await seedProduct('Product B', 500, 0);
  productC = await seedProduct('Product C', 2_000, 10, 'DRAFT');
});

afterAll(async () => {
  await app?.close();
  await sql?.end();
});

describe('cart access', () => {
  it('requires authentication', async () => {
    const res = await call('/cart');
    expect(res.status).toBe(401);
  });

  it('returns an empty cart for a fresh user', async () => {
    const res = await call<PublicCart>('/cart', { token: aliceToken });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      id: null,
      storeId: null,
      items: [],
      itemCount: 0,
      subtotal: 0,
    });
  });
});

describe('adding items', () => {
  it('adds an item with server-authoritative pricing', async () => {
    const res = await call<PublicCart>('/cart/items', {
      token: aliceToken,
      body: { productId: productA, quantity: 2 },
    });
    expect(res.status).toBe(201);
    const cart = res.body.data;
    expect(cart.id).toBeTruthy();
    expect(cart.storeId).toBe(storeId);
    expect(cart.items).toHaveLength(1);
    expect(cart.items[0]).toMatchObject({
      productId: productA,
      quantity: 2,
      unitPrice: 15_000,
      lineTotal: 30_000,
      stockQuantity: 5,
      available: true,
    });
    expect(cart.itemCount).toBe(2);
    expect(cart.subtotal).toBe(30_000);
  });

  it('rejects smuggled price fields (server is the price authority)', async () => {
    const res = await call('/cart/items', {
      token: aliceToken,
      body: { productId: productA, quantity: 1, price: 1 },
    });
    expect(res.status).toBe(400);
  });

  it('merges quantities when the same product is added again', async () => {
    await call('/cart/items', { token: aliceToken, body: { productId: productA, quantity: 1 } });
    const res = await call<PublicCart>('/cart/items', {
      token: aliceToken,
      body: { productId: productA, quantity: 2 },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.items).toHaveLength(1);
    expect(res.body.data.items[0]?.quantity).toBe(3);
  });

  it('rejects unknown products with 404', async () => {
    const res = await call('/cart/items', {
      token: aliceToken,
      body: { productId: '00000000-0000-4000-8000-000000000000', quantity: 1 },
    });
    expect(res.status).toBe(404);
    expect(errorCode(res)).toBe('PRODUCT_NOT_FOUND');
  });

  it('rejects products that are not ACTIVE', async () => {
    const res = await call('/cart/items', {
      token: aliceToken,
      body: { productId: productC, quantity: 1 },
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('PRODUCT_UNAVAILABLE');
  });

  it('rejects out-of-stock products', async () => {
    const res = await call('/cart/items', {
      token: aliceToken,
      body: { productId: productB, quantity: 1 },
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('OUT_OF_STOCK');
  });

  it('rejects quantities above sellable stock, including the merged total', async () => {
    const tooMany = await call('/cart/items', {
      token: aliceToken,
      body: { productId: productA, quantity: 6 },
    });
    expect(tooMany.status).toBe(409);
    expect(errorCode(tooMany)).toBe('INSUFFICIENT_STOCK');

    // 3 in cart + 3 more exceeds the 5 available even though each request is small.
    await call('/cart/items', { token: aliceToken, body: { productId: productA, quantity: 3 } });
    const merged = await call('/cart/items', {
      token: aliceToken,
      body: { productId: productA, quantity: 3 },
    });
    expect(merged.status).toBe(409);
    expect(errorCode(merged)).toBe('INSUFFICIENT_STOCK');
  });

  it('counts reserved stock against sellable quantity', async () => {
    await sql`UPDATE inventory SET reserved_quantity = 4 WHERE product_id = ${productA}`;
    const res = await call('/cart/items', {
      token: aliceToken,
      body: { productId: productA, quantity: 2 },
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('INSUFFICIENT_STOCK');

    const ok = await call<PublicCart>('/cart/items', {
      token: aliceToken,
      body: { productId: productA, quantity: 1 },
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.items[0]?.stockQuantity).toBe(1);
  });

  it('keeps carts separate per user', async () => {
    await call('/cart/items', { token: aliceToken, body: { productId: productA, quantity: 1 } });
    const bob = await call<PublicCart>('/cart', { token: bobToken });
    expect(bob.body.data.items).toHaveLength(0);
    expect(bob.body.data.itemCount).toBe(0);
  });
});

describe('updating and removing items', () => {
  async function addAlice(productId: string, quantity: number): Promise<string> {
    const res = await call<PublicCart>('/cart/items', {
      token: aliceToken,
      body: { productId, quantity },
    });
    return res.body.data.items[0]!.id;
  }

  it('sets an exact quantity and recomputes totals', async () => {
    const itemId = await addAlice(productA, 1);
    const res = await call<PublicCart>(`/cart/items/${itemId}`, {
      method: 'PATCH',
      token: aliceToken,
      body: { quantity: 4 },
    });
    expect(res.status).toBe(200);
    expect(res.body.data.items[0]).toMatchObject({ quantity: 4, lineTotal: 60_000 });
    expect(res.body.data.subtotal).toBe(60_000);
  });

  it('re-validates stock on quantity updates', async () => {
    const itemId = await addAlice(productA, 1);
    const res = await call(`/cart/items/${itemId}`, {
      method: 'PATCH',
      token: aliceToken,
      body: { quantity: 6 },
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('INSUFFICIENT_STOCK');
  });

  it('rejects zero/negative/oversized quantities at the DTO boundary', async () => {
    const itemId = await addAlice(productA, 1);
    for (const quantity of [0, -2, 100, 1.5]) {
      const res = await call(`/cart/items/${itemId}`, {
        method: 'PATCH',
        token: aliceToken,
        body: { quantity },
      });
      expect(res.status).toBe(400);
    }
  });

  it('does not let one user touch another user’s line (IDOR)', async () => {
    const aliceItemId = await addAlice(productA, 1);
    const patched = await call(`/cart/items/${aliceItemId}`, {
      method: 'PATCH',
      token: bobToken,
      body: { quantity: 2 },
    });
    expect(patched.status).toBe(404);
    expect(errorCode(patched)).toBe('CART_ITEM_NOT_FOUND');

    const removed = await call(`/cart/items/${aliceItemId}`, {
      method: 'DELETE',
      token: bobToken,
    });
    expect(removed.status).toBe(404);
    expect(errorCode(removed)).toBe('CART_ITEM_NOT_FOUND');

    // And Alice's cart is untouched.
    const cart = await call<PublicCart>('/cart', { token: aliceToken });
    expect(cart.body.data.items[0]?.quantity).toBe(1);
  });

  it('removes a single line', async () => {
    const itemId = await addAlice(productA, 2);
    const res = await call<PublicCart>(`/cart/items/${itemId}`, {
      method: 'DELETE',
      token: aliceToken,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(0);
    expect(res.body.data.subtotal).toBe(0);
  });

  it('clears the whole cart idempotently', async () => {
    await addAlice(productA, 1);
    const first = await call<{ cleared: boolean }>('/cart', {
      method: 'DELETE',
      token: aliceToken,
    });
    expect(first.status).toBe(200);
    expect(first.body.data.cleared).toBe(true);

    const second = await call('/cart', { method: 'DELETE', token: aliceToken });
    expect(second.status).toBe(200);

    const [cartRows] = await sql`SELECT count(*)::int AS n FROM carts`;
    expect(cartRows!.n).toBe(0);
    const [itemRows] = await sql`SELECT count(*)::int AS n FROM cart_items`;
    expect(itemRows!.n).toBe(0);
  });
});

describe('single-store carts and live prices', () => {
  it('rejects items from another store while the cart is locked', async () => {
    await call('/cart/items', { token: aliceToken, body: { productId: productA, quantity: 1 } });

    const [otherStore] = await sql`
      INSERT INTO stores (name, code, address, city, state)
      VALUES ('OtherMart', 'OTHER', '1 Far Away', 'Abuja', 'FCT') RETURNING id`;
    const [otherCategory] = await sql`
      INSERT INTO categories (store_id, name, slug) VALUES (${otherStore!.id}, 'Misc', 'misc') RETURNING id`;
    const [otherProduct] = await sql`
      INSERT INTO products (store_id, category_id, name, slug, sku, price, status)
      VALUES (${otherStore!.id}, ${otherCategory!.id}, 'Foreign Item', 'foreign-item', 'FI-1', 100, 'ACTIVE')
      RETURNING id`;
    await sql`
      INSERT INTO inventory (store_id, product_id, quantity_on_hand)
      VALUES (${otherStore!.id}, ${otherProduct!.id}, 10)`;

    const res = await call('/cart/items', {
      token: aliceToken,
      body: { productId: otherProduct!.id, quantity: 1 },
    });
    expect(res.status).toBe(409);
    expect(errorCode(res)).toBe('CART_STORE_CONFLICT');

    // After clearing, the other store's product can be added.
    await call('/cart', { method: 'DELETE', token: aliceToken });
    const ok = await call<PublicCart>('/cart/items', {
      token: aliceToken,
      body: { productId: otherProduct!.id, quantity: 1 },
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.storeId).toBe(otherStore!.id);
  });

  it('reads prices live from the products table (never a client snapshot)', async () => {
    await call('/cart/items', { token: aliceToken, body: { productId: productA, quantity: 2 } });
    // Price changes after the item is already in the cart.
    await sql`UPDATE products SET price = 12_500 WHERE id = ${productA}`;

    const res = await call<PublicCart>('/cart', { token: aliceToken });
    expect(res.body.data.items[0]).toMatchObject({ unitPrice: 12_500, lineTotal: 25_000 });
    expect(res.body.data.subtotal).toBe(25_000);
  });

  it('marks lines unavailable when stock drops below the cart quantity', async () => {
    await call('/cart/items', { token: aliceToken, body: { productId: productA, quantity: 3 } });
    await sql`UPDATE inventory SET quantity_on_hand = 2 WHERE product_id = ${productA}`;

    const res = await call<PublicCart>('/cart', { token: aliceToken });
    expect(res.body.data.items[0]?.available).toBe(false);
    expect(res.body.data.items[0]?.stockQuantity).toBe(2);
  });
});
