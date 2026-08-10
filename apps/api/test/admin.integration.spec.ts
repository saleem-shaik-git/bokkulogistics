import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import postgres from 'postgres';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  AdminAuditLog,
  AdminDashboardSummary,
  AdminStoreRow,
  ApiResponse,
  AuthResponse,
  InitializePaymentResult,
  Paginated,
  PublicOrderDetail,
  PublicOrderSummary,
  PublicUser,
} from '@bokku/shared';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { TEST_DATABASE_URL } from './global-setup';

/**
 * Platform admin surface against real PostgreSQL: RBAC (PLATFORM_ADMIN
 * only), dashboard aggregates, user search/filter/pagination, audited
 * role & status mutations (with store_membership side effects and the
 * self/last-admin protections), store oversight, cross-store order reads
 * and the audit-trail endpoint.
 */

interface Envelope<T> {
  status: number;
  body: ApiResponse<T> & { data: T };
}

let app: INestApplication;
let baseUrl: string;
let sql: postgres.Sql;

let adminToken: string;
let customerToken: string;
let managerToken: string;
let adminId: string;
let customerId: string;
let managerId: string;
let storeId: string;
let customerAddressId: string;
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

async function userId(email: string): Promise<string> {
  const [row] = await sql`SELECT id FROM users WHERE email = ${email}`;
  return row!.id;
}

/** A fully paid order for the customer (2 × product A @ 15,000 kobo). */
async function paidOrderId(): Promise<string> {
  await call('/cart/items', { token: customerToken, body: { productId: productA, quantity: 2 } });
  const init = await call<InitializePaymentResult>('/payments/initialize', {
    token: customerToken,
    body: { addressId: customerAddressId },
  });
  const reference = init.body.data.reference;
  await call('/payments/mock/complete', { body: { reference, outcome: 'success' } });
  const placed = await call<PublicOrderDetail>('/orders', {
    token: customerToken,
    body: { paymentReference: reference },
  });
  return placed.body.data.id;
}

beforeAll(async () => {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.REDIS_URL = 'redis://127.0.0.1:6379/1';
  process.env.NODE_ENV = 'test';
  sql = postgres(TEST_DATABASE_URL, { max: 3 });

  app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
  configureApp(app);
  await app.listen(0);
  const address = app.getHttpServer().address();
  if (typeof address === 'string' || !address) throw new Error('no address');
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
}, 60_000);

beforeEach(async () => {
  await sql`TRUNCATE users, stores, categories, products, product_images, inventory, store_staff, carts, cart_items, addresses, payments, orders, order_items, deliveries, audit_logs CASCADE`;

  await createUser('admin@test.dev', 'PLATFORM_ADMIN');
  await createUser('customer@test.dev');
  await createUser('manager@test.dev', 'STORE_MANAGER');
  await createUser('owner@test.dev', 'BOKKU_ADMIN');

  const [store] = await sql`
    INSERT INTO stores (name, code, address, city, state)
    VALUES ('Bokku', 'BOKKU', '12 Market Street', 'Lagos', 'Lagos') RETURNING id`;
  storeId = store!.id;
  const [category] = await sql`
    INSERT INTO categories (store_id, name, slug) VALUES (${storeId}, 'Food', 'food') RETURNING id`;
  const [product] = await sql`
    INSERT INTO products (store_id, category_id, name, slug, sku, price, status)
    VALUES (${storeId}, ${category!.id}, 'Product A', 'product-a', 'SKU-A', 15_000, 'ACTIVE')
    RETURNING id`;
  productA = product!.id;
  await sql`
    INSERT INTO inventory (store_id, product_id, quantity_on_hand)
    VALUES (${storeId}, ${productA}, 50)`;

  adminId = await userId('admin@test.dev');
  customerId = await userId('customer@test.dev');
  managerId = await userId('manager@test.dev');
  await sql`INSERT INTO store_staff (store_id, user_id) VALUES (${storeId}, ${managerId})`;

  adminToken = await login('admin@test.dev');
  customerToken = await login('customer@test.dev');
  managerToken = await login('manager@test.dev');

  const addr = await call<{ id: string }>('/addresses', {
    token: customerToken,
    body: { label: 'Home', street: '24 Allen Avenue, Ikeja', city: 'Lagos', state: 'Lagos' },
  });
  customerAddressId = addr.body.data.id;
});

afterAll(async () => {
  await app?.close();
  await sql?.end();
});

describe('RBAC: PLATFORM_ADMIN only', () => {
  it('rejects customers, store staff and anonymous callers', async () => {
    expect((await call('/admin/dashboard')).status).toBe(401);
    for (const token of [customerToken, managerToken]) {
      const res = await call('/admin/dashboard', { token });
      expect(res.status).toBe(403);
      expect(errorCode(res)).toBe('AUTH_ACCESS_DENIED');
    }
    // BOKKU_ADMIN (store-level admin) is NOT platform admin.
    const ownerToken = await login('owner@test.dev');
    expect((await call('/admin/users', { token: ownerToken })).status).toBe(403);
    expect((await call('/admin/audit-logs', { token: ownerToken })).status).toBe(403);
  });

  it('serves the dashboard to PLATFORM_ADMIN with coherent aggregates', async () => {
    await paidOrderId();
    const res = await call<AdminDashboardSummary>('/admin/dashboard', { token: adminToken });
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.todayOrders).toBe(1);
    expect(d.allTimeOrders).toBe(1);
    expect(d.todayRevenue).toBeGreaterThan(0);
    expect(d.allTimeRevenue).toBe(d.todayRevenue);
    expect(d.ordersByStatus['PAID']).toBe(1);
    expect(d.totalUsers).toBe(4);
    expect(d.usersByRole['PLATFORM_ADMIN']).toBe(1);
    expect(d.usersByRole['CUSTOMER']).toBe(1);
    expect(d.suspendedUsers).toBe(0);
    expect(d.totalStores).toBe(1);
    expect(d.activeDeliveries).toBe(0);
  });
});

describe('user management', () => {
  it('lists users with role/status filters, name/email search and pagination', async () => {
    await sql`UPDATE users SET first_name = 'Zephyr' WHERE email = 'customer@test.dev'`;

    const byRole = await call<Paginated<PublicUser>>('/admin/users?role=PLATFORM_ADMIN', {
      token: adminToken,
    });
    expect(byRole.body.data.data.map((u) => u.email)).toEqual(['admin@test.dev']);

    const bySearch = await call<Paginated<PublicUser>>('/admin/users?q=zephy', {
      token: adminToken,
    });
    expect(bySearch.body.data.data.map((u) => u.email)).toEqual(['customer@test.dev']);

    const byEmail = await call<Paginated<PublicUser>>('/admin/users?q=MANAGER@test', {
      token: adminToken,
    });
    expect(byEmail.body.data.data).toHaveLength(1);

    // ILIKE metacharacters are escaped — "%" matches nothing literal.
    const escaped = await call<Paginated<PublicUser>>('/admin/users?q=%25', {
      token: adminToken,
    });
    expect(escaped.body.data.meta.total).toBe(0);

    // Pagination envelope + limit clamp.
    const paged = await call<Paginated<PublicUser>>('/admin/users?page=2&limit=3', {
      token: adminToken,
    });
    expect(paged.body.data.meta).toMatchObject({ page: 2, limit: 3, total: 4, totalPages: 2 });
    const clamped = await call<Paginated<PublicUser>>('/admin/users?limit=500', {
      token: adminToken,
    });
    expect(clamped.body.data.meta.limit).toBe(100);

    // Soft-deleted accounts never appear.
    await sql`UPDATE users SET deleted_at = now() WHERE email = 'manager@test.dev'`;
    const afterDelete = await call<Paginated<PublicUser>>('/admin/users', { token: adminToken });
    expect(afterDelete.body.data.meta.total).toBe(3);
  });

  it('rejects invalid filter values with 400', async () => {
    expect((await call('/admin/users?role=SUPERUSER', { token: adminToken })).status).toBe(400);
    expect((await call('/admin/users?status=BANNED', { token: adminToken })).status).toBe(400);
  });

  it('changes roles, manages store membership and audits every change', async () => {
    // Promote the customer to STORE_MANAGER → store_staff row appears.
    const promoted = await call<PublicUser>(`/admin/users/${customerId}/role`, {
      method: 'PATCH',
      token: adminToken,
      body: { role: 'STORE_MANAGER', reason: 'hired' },
    });
    expect(promoted.body.data.role).toBe('STORE_MANAGER');
    const membership = await sql`
      SELECT 1 FROM store_staff WHERE store_id = ${storeId} AND user_id = ${customerId}`;
    expect(membership).toHaveLength(1);

    // …and the promoted user can now reach store operations.
    const freshCustomerToken = await login('customer@test.dev');
    expect((await call('/bokku/dashboard', { token: freshCustomerToken })).status).toBe(200);

    // Demote back to CUSTOMER → membership removed → /bokku 403s again.
    const demoted = await call<PublicUser>(`/admin/users/${customerId}/role`, {
      method: 'PATCH',
      token: adminToken,
      body: { role: 'CUSTOMER' },
    });
    expect(demoted.body.data.role).toBe('CUSTOMER');
    expect(
      await sql`SELECT 1 FROM store_staff WHERE store_id = ${storeId} AND user_id = ${customerId}`,
    ).toHaveLength(0);
    expect(
      (await call('/bokku/dashboard', { token: await login('customer@test.dev') })).status,
    ).toBe(403);

    // Audit trail has both changes with from/to metadata.
    const audit = await sql`
      SELECT action, metadata FROM audit_logs
      WHERE action = 'admin.user_role_changed' AND entity_id = ${customerId} ORDER BY created_at`;
    expect(audit).toHaveLength(2);
    expect(audit[0]!.metadata).toMatchObject({ from: 'CUSTOMER', to: 'STORE_MANAGER' });
    expect(audit[1]!.metadata).toMatchObject({ from: 'STORE_MANAGER', to: 'CUSTOMER' });

    // Idempotent: same role again → 200, no extra audit row.
    const noop = await call<PublicUser>(`/admin/users/${customerId}/role`, {
      method: 'PATCH',
      token: adminToken,
      body: { role: 'CUSTOMER' },
    });
    expect(noop.status).toBe(200);
    const auditAfter = await sql`
      SELECT 1 FROM audit_logs WHERE action = 'admin.user_role_changed' AND entity_id = ${customerId}`;
    expect(auditAfter).toHaveLength(2);
  });

  it('refuses self-modification and unknown users', async () => {
    const self = await call<PublicUser>(`/admin/users/${adminId}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: { status: 'SUSPENDED' },
    });
    expect(self.status).toBe(409);
    expect(errorCode(self)).toBe('ADMIN_SELF_MODIFICATION');

    const selfRole = await call<PublicUser>(`/admin/users/${adminId}/role`, {
      method: 'PATCH',
      token: adminToken,
      body: { role: 'CUSTOMER' },
    });
    expect(errorCode(selfRole)).toBe('ADMIN_SELF_MODIFICATION');

    const missing = await call<PublicUser>(
      '/admin/users/9d6f8e7c-1111-4222-8333-944455556666/role',
      { method: 'PATCH', token: adminToken, body: { role: 'CUSTOMER' } },
    );
    expect(missing.status).toBe(404);
    expect(errorCode(missing)).toBe('USER_NOT_FOUND');
  });

  it('suspends (immediate effect) and reactivates users, audited', async () => {
    const suspended = await call<PublicUser>(`/admin/users/${customerId}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: { status: 'SUSPENDED', reason: 'fraud review' },
    });
    expect(suspended.body.data.status).toBe('SUSPENDED');

    // The JWT guard re-loads the user per request → old tokens die now.
    const me = await call<PublicUser>('/users/me', { token: customerToken });
    expect(me.status).toBe(403);
    expect(errorCode(me)).toBe('AUTH_ACCOUNT_INACTIVE');

    // Fresh logins are rejected too; reactivation restores access.
    expect(
      (await call('/auth/login', { body: { email: 'customer@test.dev', password } })).status,
    ).toBe(403);
    const reactivated = await call<PublicUser>(`/admin/users/${customerId}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: { status: 'ACTIVE' },
    });
    expect(reactivated.body.data.status).toBe('ACTIVE');
    expect(
      (await call('/auth/login', { body: { email: 'customer@test.dev', password } })).status,
    ).toBe(200);

    const audit = await sql`
      SELECT metadata FROM audit_logs
      WHERE action = 'admin.user_status_changed' AND entity_id = ${customerId} ORDER BY created_at`;
    expect(audit).toHaveLength(2);
    expect(audit[0]!.metadata).toMatchObject({ from: 'ACTIVE', to: 'SUSPENDED' });

    // Dashboard reflects the suspension count live.
    await call<PublicUser>(`/admin/users/${managerId}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: { status: 'SUSPENDED' },
    });
    const dash = await call<AdminDashboardSummary>('/admin/dashboard', { token: adminToken });
    expect(dash.body.data.suspendedUsers).toBe(1);
  });
});

describe('store + order oversight', () => {
  it('lists stores with staff/product counts and today’s numbers', async () => {
    await paidOrderId();
    const res = await call<AdminStoreRow[]>('/admin/stores', { token: adminToken });
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const store = res.body.data[0]!;
    expect(store).toMatchObject({
      code: 'BOKKU',
      status: 'ACTIVE',
      staffCount: 1,
      productCount: 1,
      totalOrders: 1,
      todayOrders: 1,
    });
    expect(store.todayRevenue).toBeGreaterThan(0);
  });

  it('lists orders cross-store with filters and reads any order detail', async () => {
    const orderId = await paidOrderId();

    const all = await call<Paginated<PublicOrderSummary>>('/admin/orders', { token: adminToken });
    expect(all.body.data.meta.total).toBe(1);
    expect(all.body.data.data[0]!.id).toBe(orderId);

    const byStore = await call<Paginated<PublicOrderSummary>>(`/admin/orders?storeId=${storeId}`, {
      token: adminToken,
    });
    expect(byStore.body.data.meta.total).toBe(1);
    const wrongStore = await call<Paginated<PublicOrderSummary>>(
      '/admin/orders?storeId=9d6f8e7c-1111-4222-8333-944455556666',
      { token: adminToken },
    );
    expect(wrongStore.body.data.meta.total).toBe(0);

    const byStatus = await call<Paginated<PublicOrderSummary>>('/admin/orders?status=DELIVERED', {
      token: adminToken,
    });
    expect(byStatus.body.data.meta.total).toBe(0);
    expect((await call('/admin/orders?status=BOGUS', { token: adminToken })).status).toBe(400);

    const detail = await call<PublicOrderDetail>(`/admin/orders/${orderId}`, {
      token: adminToken,
    });
    expect(detail.body.data.id).toBe(orderId);
    expect(detail.body.data.items.length).toBeGreaterThan(0);

    const missing = await call<PublicOrderDetail>(
      '/admin/orders/9d6f8e7c-1111-4222-8333-944455556666',
      { token: adminToken },
    );
    expect(missing.status).toBe(404);
  });
});

describe('audit trail endpoint', () => {
  it('returns admin + order actions, prefix-filtered and paginated', async () => {
    await call(`/admin/users/${managerId}/status`, {
      method: 'PATCH',
      token: adminToken,
      body: { status: 'SUSPENDED' },
    });

    const adminActions = await call<Paginated<AdminAuditLog>>('/admin/audit-logs?action=admin', {
      token: adminToken,
    });
    expect(adminActions.body.data.meta.total).toBe(1);
    const row = adminActions.body.data.data[0]!;
    expect(row.action).toBe('admin.user_status_changed');
    expect(row.actor?.email).toBe('admin@test.dev');
    expect(row.entityType).toBe('user');

    const none = await call<Paginated<AdminAuditLog>>('/admin/audit-logs?action=payments', {
      token: adminToken,
    });
    expect(none.body.data.meta.total).toBe(0);

    const byActor = await call<Paginated<AdminAuditLog>>(`/admin/audit-logs?actorId=${adminId}`, {
      token: adminToken,
    });
    expect(byActor.body.data.meta.total).toBeGreaterThanOrEqual(1);

    // Login events exist in the unfiltered stream (auth.login.*).
    const everything = await call<Paginated<AdminAuditLog>>('/admin/audit-logs?limit=50', {
      token: adminToken,
    });
    expect(everything.body.data.data.some((r) => r.action.startsWith('auth.login'))).toBe(true);
    expect(everything.body.data.data[0]!.createdAt >= row.createdAt).toBe(true);
  });
});
