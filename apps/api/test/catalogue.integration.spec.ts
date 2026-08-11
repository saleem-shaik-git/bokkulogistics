import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  ApiResponse,
  AuthResponse,
  Paginated,
  PublicCategory,
  PublicProductDetail,
  PublicProductListItem,
  PublicStore,
} from '@bokku/shared';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { TEST_DATABASE_URL } from './global-setup';

/**
 * Catalogue journey against real PostgreSQL:
 * browse stores/categories/products (pagination, search, filters),
 * bokku staff-creates product, inventory guard rails, RBAC + staff isolation.
 */

interface Envelope<T> {
  status: number;
  body: ApiResponse<T> & { data: T };
}

let app: INestApplication;
let baseUrl: string;
let sql: postgres.Sql;

let storeId: string;
let foodCategoryId: string;
let customerToken: string;
let managerToken: string;

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

async function login(email: string): Promise<string> {
  const res = await call<AuthResponse>('/auth/login', { body: { email, password } });
  return res.body.data.tokens.accessToken;
}

async function createUser(email: string, role?: string): Promise<void> {
  await call('/auth/register', {
    body: { email, password, firstName: 'T', lastName: 'U' },
  });
  if (role) {
    await sql`UPDATE users SET role = ${role} WHERE email = ${email}`;
  }
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
  // Rebuild a deterministic catalogue for every test.
  await sql`TRUNCATE users, stores, categories, products, product_images, inventory, store_staff CASCADE`;

  await createUser('customer@test.dev', 'CUSTOMER');
  await createUser('manager@test.dev', 'STORE_MANAGER');
  await createUser('boss@test.dev', 'BOKKU_ADMIN');
  await createUser('rogue@test.dev', 'STORE_MANAGER'); // no store_staff link

  const [store] = await sql`
    INSERT INTO stores (name, code, address, city, state)
    VALUES ('Bokku', 'BOKKU', '12 Market Street', 'Lagos', 'Lagos') RETURNING id`;
  storeId = store!.id;

  const [food, drinks] = await sql`
    INSERT INTO categories (store_id, name, slug, sort_order) VALUES
      (${storeId}, 'Food', 'food', 0),
      (${storeId}, 'Drinks', 'drinks', 1)
    RETURNING id`;
  foodCategoryId = food!.id;

  // 12 products: one out of stock, two drinks, rest food.
  const rows = [];
  for (let i = 1; i <= 12; i++) {
    const isDrink = i <= 2;
    rows.push({
      name: isDrink ? `Zobo Drink ${i}L` : `Test Product ${i}`,
      category_id: isDrink ? drinks!.id : food!.id,
      sku: `SKU-${String(i).padStart(3, '0')}`,
      price: i * 10_000,
      stock: i === 5 ? 0 : i * 10,
    });
  }
  for (const row of rows) {
    const [product] = await sql`
      INSERT INTO products (store_id, category_id, name, slug, sku, price, status)
      VALUES (${storeId}, ${row.category_id}, ${row.name}, ${row.sku.toLowerCase()}, ${row.sku}, ${row.price}, 'ACTIVE')
      RETURNING id`;
    await sql`
      INSERT INTO inventory (store_id, product_id, quantity_on_hand)
      VALUES (${storeId}, ${product!.id}, ${row.stock})`;
  }

  const [manager] = await sql`SELECT id FROM users WHERE email = 'manager@test.dev'`;
  const [boss] = await sql`SELECT id FROM users WHERE email = 'boss@test.dev'`;
  await sql`INSERT INTO store_staff (store_id, user_id) VALUES (${storeId}, ${manager!.id}), (${storeId}, ${boss!.id})`;

  customerToken = await login('customer@test.dev');
  managerToken = await login('manager@test.dev');
});

afterAll(async () => {
  await app?.close();
  await sql?.end();
});

describe('public catalogue', () => {
  it('lists active stores with pagination metadata', async () => {
    const res = await call<Paginated<PublicStore>>('/stores');
    expect(res.status).toBe(200);
    expect(res.body.data.data[0]?.name).toBe('Bokku');
    expect(res.body.data.meta).toMatchObject({ page: 1, limit: 20, total: 1, totalPages: 1 });
  });

  it('returns store detail and categories', async () => {
    const store = await call<PublicStore>(`/stores/${storeId}`);
    expect(store.status).toBe(200);
    expect(store.body.data.city).toBe('Lagos');

    const cats = await call<PublicCategory[]>(`/stores/${storeId}/categories`);
    expect(cats.body.data.map((c) => c.slug)).toEqual(['food', 'drinks']);
  });

  it('paginates products deterministically', async () => {
    const page1 = await call<Paginated<PublicProductListItem>>(
      `/stores/${storeId}/products?page=1&limit=5`,
    );
    const page3 = await call<Paginated<PublicProductListItem>>(
      `/stores/${storeId}/products?page=3&limit=5`,
    );
    expect(page1.body.data.data).toHaveLength(5);
    expect(page1.body.data.meta).toMatchObject({ total: 12, totalPages: 3 });
    expect(page3.body.data.data.length).toBeLessThanOrEqual(2);
    const ids1 = new Set(page1.body.data.data.map((p) => p.id));
    expect(page3.body.data.data.some((p) => ids1.has(p.id))).toBe(false);
  });

  it('caps excessive limits at 100', async () => {
    const res = await call<Paginated<PublicProductListItem>>(
      `/stores/${storeId}/products?limit=1000`,
    );
    expect(res.body.data.meta.limit).toBe(100);
  });

  it('searches by name and filters by category slug', async () => {
    const search = await call<Paginated<PublicProductListItem>>(
      `/stores/${storeId}/products?q=zobo`,
    );
    expect(search.body.data.meta.total).toBe(2);
    expect(search.body.data.data.every((p) => p.name.toLowerCase().includes('zobo'))).toBe(true);

    const drinks = await call<Paginated<PublicProductListItem>>(
      `/stores/${storeId}/products?category=drinks`,
    );
    expect(drinks.body.data.meta.total).toBe(2);
    expect(drinks.body.data.data.every((p) => p.categorySlug === 'drinks')).toBe(true);
  });

  it('does not explode on a non-UUID category value', async () => {
    const res = await call<Paginated<PublicProductListItem>>(
      `/stores/${storeId}/products?category=not-a-uuid`,
    );
    expect(res.status).toBe(200);
    expect(res.body.data.meta.total).toBe(0);
  });

  it('reports availability and out-of-stock correctly', async () => {
    const list = await call<Paginated<PublicProductListItem>>(
      `/stores/${storeId}/products?limit=20`,
    );
    const outOfStock = list.body.data.data.find((p) => p.name === 'Test Product 5');
    expect(outOfStock?.stockQuantity).toBe(0);
    expect(outOfStock?.available).toBe(false);
    const inStock = list.body.data.data.find((p) => p.name === 'Test Product 3');
    expect(inStock?.available).toBe(true);
    expect(inStock?.stockQuantity).toBe(30);
  });

  it('returns the standard envelope for an unknown product', async () => {
    const res = await call('/products/00000000-0000-4000-8000-000000000000');
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect((res.body as unknown as { error: { code: string } }).error.code).toBe(
      'PRODUCT_NOT_FOUND',
    );
  });

  it('returns product detail with synthesized cover gallery', async () => {
    const list = await call<Paginated<PublicProductListItem>>(
      `/stores/${storeId}/products?limit=1`,
    );
    const id = list.body.data.data[0]!.id;
    const detail = await call<PublicProductDetail>(`/products/${id}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.sku).toBeTruthy();
    expect(Array.isArray(detail.body.data.images)).toBe(true);
  });
});

describe('bokku catalogue operations', () => {
  it('rejects customers with 403', async () => {
    const res = await call('/bokku/products', { token: customerToken });
    expect(res.status).toBe(403);
  });

  it('rejects store managers without a staff link (rule 9)', async () => {
    const rogueToken = await login('rogue@test.dev');
    const res = await call('/bokku/products', {
      token: rogueToken,
      body: { name: 'Rogue Product', categoryId: foodCategoryId, price: 1000 },
    });
    expect(res.status).toBe(403);
    expect((res.body as unknown as { error: { code: string } }).error.code).toBe('NOT_STORE_STAFF');
  });

  it('lets staff create products with auto slug/sku and initial stock', async () => {
    const res = await call<{ id: string; slug: string; sku: string; price: number }>(
      '/bokku/products',
      {
        token: managerToken,
        body: {
          name: 'Agege Bread Loaf',
          categoryId: foodCategoryId,
          price: 90000,
          initialStock: 15,
        },
      },
    );
    expect(res.status).toBe(201);
    expect(res.body.data.slug).toBe('agege-bread-loaf');
    expect(res.body.data.sku).toBeTruthy();

    const productId = res.body.data.id;
    const [stock] =
      await sql`SELECT quantity_on_hand FROM inventory WHERE product_id = ${productId}`;
    expect(stock!.quantity_on_hand).toBe(15);

    const audits = await sql`SELECT action FROM audit_logs WHERE action = 'product.created'`;
    expect(audits).toHaveLength(1);
  });

  it('rejects cross-store category ids', async () => {
    // A category from some other (nonexistent) store context.
    const [otherStore] = await sql`
      INSERT INTO stores (name, code, address, city, state)
      VALUES ('OtherMart', 'OTHER', '1 Far Away', 'Abuja', 'FCT') RETURNING id`;
    const [otherCategory] = await sql`
      INSERT INTO categories (store_id, name, slug) VALUES (${otherStore!.id}, 'Evil', 'evil') RETURNING id`;

    const res = await call('/bokku/products', {
      token: managerToken,
      body: { name: 'Sneaky', categoryId: otherCategory!.id, price: 1000 },
    });
    expect(res.status).toBe(404);
    expect((res.body as unknown as { error: { code: string } }).error.code).toBe(
      'CATEGORY_NOT_FOUND',
    );
  });

  it('audits price changes', async () => {
    const created = await call<{ id: string }>('/bokku/products', {
      token: managerToken,
      body: { name: 'Price Tracked Item', categoryId: foodCategoryId, price: 10000 },
    });
    const id = created.body.data.id;
    await call(`/bokku/products/${id}`, {
      method: 'PATCH',
      token: managerToken,
      body: { price: 12500 },
    });
    const [audit] = await sql`
      SELECT metadata->>'before' AS before, metadata->>'after' AS after
      FROM audit_logs WHERE action = 'product.price_changed' AND entity_id = ${id}`;
    expect(audit).toMatchObject({ before: '10000', after: '12500' });
  });

  it('never lets stock go negative', async () => {
    const created = await call<{ id: string }>('/bokku/products', {
      token: managerToken,
      body: { name: 'Guarded Stock', categoryId: foodCategoryId, price: 1000, initialStock: 5 },
    });
    const id = created.body.data.id;

    const negative = await call(`/bokku/inventory/${id}`, {
      method: 'PATCH',
      token: managerToken,
      body: { adjustment: -6, reason: 'too many' },
    });
    expect(negative.status).toBe(409);
    expect((negative.body as unknown as { error: { code: string } }).error.code).toBe(
      'INSUFFICIENT_STOCK',
    );

    const ok = await call<{ quantityOnHand: number }>(`/bokku/inventory/${id}`, {
      method: 'PATCH',
      token: managerToken,
      body: { adjustment: -5, reason: 'exact drain' },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.quantityOnHand).toBe(0);

    const [row] = await sql`SELECT quantity_on_hand FROM inventory WHERE product_id = ${id}`;
    expect(row!.quantity_on_hand).toBe(0);
  });

  it('requires a reason and an amount for adjustments', async () => {
    const created = await call<{ id: string }>('/bokku/products', {
      token: managerToken,
      body: { name: 'Validation Target', categoryId: foodCategoryId, price: 1000 },
    });
    const id = created.body.data.id;
    const noAmount = await call(`/bokku/inventory/${id}`, {
      method: 'PATCH',
      token: managerToken,
      body: { reason: 'no amounts here' },
    });
    expect(noAmount.status).toBe(400);
    const noReason = await call(`/bokku/inventory/${id}`, {
      method: 'PATCH',
      token: managerToken,
      body: { adjustment: 1 },
    });
    expect(noReason.status).toBe(400);
  });
});
