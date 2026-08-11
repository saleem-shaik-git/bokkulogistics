import {
  BadGatewayException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  and,
  count,
  desc,
  eq,
  gte,
  ilike,
  isNull,
  lte,
  ne,
  notInArray,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  auditLogs,
  deliveries,
  orders,
  payments,
  products,
  storeStaff,
  stores,
  users,
  type DatabaseConnection,
  type Store,
  type User,
} from '@bokku/database';
import type {
  AdminAuditLog,
  AdminDashboardSummary,
  AdminStoreRow,
  DeliveryStatus,
  OrderStatus,
  Paginated,
  PublicOrderDetail,
  PublicOrderSummary,
  PublicUser,
  UserRole,
} from '@bokku/shared';

import { DRIZZLE_CLIENT } from '../../config/constants';
import { buildPaginationMeta, parsePagination } from '../../common/pagination';
import { PaymentIntegrationError } from '../../integrations/payments/payment-provider.interface';
import { AuditService } from '../audit/audit.module';
import { BOKKU_STORE_CODE } from '../bokku/guards/store-staff.guard';
import { OrdersService } from '../orders/orders.service';
import { PaymentsService } from '../payments/payments.service';
import type {
  ListAdminAuditLogsQuery,
  ListAdminOrdersQuery,
  ListAdminUsersQuery,
  UpdateAdminStoreStatusDto,
  UpdateAdminUserRoleDto,
  UpdateAdminUserStatusDto,
} from './dto/admin.dto';

/** Order states in which the customer's money has been (or is being) returned. */
const REVENUE_LOST_STATUSES: OrderStatus[] = ['CANCELLED', 'REFUND_PENDING', 'REFUNDED'];
const ACTIVE_DELIVERY_STATUSES: readonly DeliveryStatus[] = [
  'REQUESTED',
  'DRIVER_ASSIGNED',
  'DRIVER_ARRIVING',
  'PICKED_UP',
  'IN_TRANSIT',
];
/** Staff roles whose Bokku store membership rows are managed on role change. */
const STAFF_ROLES: readonly UserRole[] = ['STORE_MANAGER', 'BOKKU_ADMIN'];

export interface AdminRequestContext {
  ip?: string;
  userAgent?: string;
}

/**
 * Platform admin domain logic. Read endpoints are cross-store by design.
 * User mutations refuse self-modification and last-admin lockouts, keep
 * store_staff membership consistent with the assigned role (single-store
 * platform), and always land in the audit trail.
 */
@Injectable()
export class AdminService {
  constructor(
    @Inject(DRIZZLE_CLIENT) private readonly database: DatabaseConnection,
    private readonly ordersService: OrdersService,
    private readonly paymentsService: PaymentsService,
    private readonly audit: AuditService,
  ) {}

  // ── Dashboard ───────────────────────────────────────────────────

  async getDashboard(): Promise<AdminDashboardSummary> {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const [orderAgg, ordersByStatusRows, deliveryRows, userAgg, usersByRoleRows, storeAgg] =
      await Promise.all([
        this.database.db
          .select({
            todayOrders:
              sql<number>`count(*) filter (where ${gte(orders.createdAt, startOfToday)})`.mapWith(
                Number,
              ),
            todayRevenue:
              sql<number>`coalesce(sum(${orders.total}) filter (where ${gte(orders.paidAt, startOfToday)} and ${notInArray(orders.status, REVENUE_LOST_STATUSES)}), 0)`.mapWith(
                Number,
              ),
            allTimeOrders: count(),
            allTimeRevenue:
              sql<number>`coalesce(sum(${orders.total}) filter (where ${notInArray(orders.status, REVENUE_LOST_STATUSES)}), 0)`.mapWith(
                Number,
              ),
          })
          .from(orders),
        this.database.db
          .select({ status: orders.status, n: count() })
          .from(orders)
          .groupBy(orders.status),
        this.database.db
          .select({ status: deliveries.status, n: count() })
          .from(deliveries)
          .groupBy(deliveries.status),
        this.database.db
          .select({
            totalUsers: count(),
            newUsersToday:
              sql<number>`count(*) filter (where ${gte(users.createdAt, startOfToday)})`.mapWith(
                Number,
              ),
            suspendedUsers:
              sql<number>`count(*) filter (where ${eq(users.status, 'SUSPENDED')})`.mapWith(Number),
          })
          .from(users)
          .where(isNull(users.deletedAt)),
        this.database.db
          .select({ role: users.role, n: count() })
          .from(users)
          .where(isNull(users.deletedAt))
          .groupBy(users.role),
        this.database.db
          .select({
            totalStores: count(),
            activeStores:
              sql<number>`count(*) filter (where ${eq(stores.status, 'ACTIVE')})`.mapWith(Number),
          })
          .from(stores),
      ]);

    const ordersByStatus: Partial<Record<OrderStatus, number>> = {};
    for (const row of ordersByStatusRows) ordersByStatus[row.status] = row.n;

    const deliveriesByStatus: Partial<Record<DeliveryStatus, number>> = {};
    let activeDeliveries = 0;
    for (const row of deliveryRows) {
      deliveriesByStatus[row.status] = row.n;
      if (ACTIVE_DELIVERY_STATUSES.includes(row.status)) activeDeliveries += row.n;
    }

    const usersByRole: Partial<Record<UserRole, number>> = {};
    for (const row of usersByRoleRows) usersByRole[row.role] = row.n;

    const o = orderAgg[0];
    const u = userAgg[0];
    const s = storeAgg[0];
    return {
      todayOrders: o?.todayOrders ?? 0,
      todayRevenue: o?.todayRevenue ?? 0,
      allTimeOrders: o?.allTimeOrders ?? 0,
      allTimeRevenue: o?.allTimeRevenue ?? 0,
      ordersByStatus,
      activeDeliveries,
      deliveriesByStatus,
      totalUsers: u?.totalUsers ?? 0,
      usersByRole,
      newUsersToday: u?.newUsersToday ?? 0,
      suspendedUsers: u?.suspendedUsers ?? 0,
      totalStores: s?.totalStores ?? 0,
      activeStores: s?.activeStores ?? 0,
    };
  }

  // ── User management ─────────────────────────────────────────────

  async listUsers(query: ListAdminUsersQuery): Promise<Paginated<PublicUser>> {
    const { page, limit, offset } = parsePagination(query);
    const filters: SQL[] = [isNull(users.deletedAt)];
    if (query.role) filters.push(eq(users.role, query.role));
    if (query.status) filters.push(eq(users.status, query.status));
    if (query.q?.trim()) filters.push(ilikeFilter(query.q.trim()));
    const where = and(...filters);

    const [rows, countRows] = await Promise.all([
      this.database.db
        .select()
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(limit)
        .offset(offset),
      this.database.db.select({ total: count() }).from(users).where(where),
    ]);
    const total = countRows[0]?.total ?? 0;
    return {
      data: rows.map((row) => this.toPublic(row)),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async updateUserRole(
    actor: User,
    targetId: string,
    dto: UpdateAdminUserRoleDto,
    context: AdminRequestContext,
  ): Promise<PublicUser> {
    if (actor.id === targetId) {
      throw new ConflictException({
        code: 'ADMIN_SELF_MODIFICATION',
        message: 'Change another admin’s role, not your own',
      });
    }
    const target = await this.requireUser(targetId);
    if (target.role === dto.role) return this.toPublic(target); // idempotent no-op

    if (target.role === 'PLATFORM_ADMIN') await this.assertOtherActiveAdminExists(target);

    const store = STAFF_ROLES.includes(dto.role) ? await this.requireBokkuStore() : null;

    const updated = await this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({ role: dto.role, updatedAt: new Date() })
        .where(eq(users.id, target.id))
        .returning();
      // Keep store membership consistent with the new role: staff roles
      // get BOKKU membership; demotion away from staff removes all rows.
      if (STAFF_ROLES.includes(dto.role) && !STAFF_ROLES.includes(target.role) && store) {
        await tx
          .insert(storeStaff)
          .values({ storeId: store.id, userId: target.id })
          .onConflictDoNothing();
      } else if (STAFF_ROLES.includes(target.role) && !STAFF_ROLES.includes(dto.role)) {
        await tx.delete(storeStaff).where(eq(storeStaff.userId, target.id));
      }
      return row ?? { ...target, role: dto.role };
    });

    await this.audit.record({
      actorUserId: actor.id,
      action: 'admin.user_role_changed',
      entityType: 'user',
      entityId: target.id,
      metadata: {
        targetEmail: target.email,
        from: target.role,
        to: dto.role,
        ...(dto.reason ? { reason: dto.reason } : {}),
      },
      ipAddress: context.ip,
      userAgent: context.userAgent,
    });
    return this.toPublic(updated);
  }

  async updateUserStatus(
    actor: User,
    targetId: string,
    dto: UpdateAdminUserStatusDto,
    context: AdminRequestContext,
  ): Promise<PublicUser> {
    if (actor.id === targetId) {
      throw new ConflictException({
        code: 'ADMIN_SELF_MODIFICATION',
        message: 'Suspend another admin’s account, not your own',
      });
    }
    const target = await this.requireUser(targetId);
    if (target.status === dto.status) return this.toPublic(target); // idempotent no-op

    if (dto.status === 'SUSPENDED' && target.role === 'PLATFORM_ADMIN') {
      await this.assertOtherActiveAdminExists(target);
    }

    const [updated] = await this.database.db
      .update(users)
      .set({ status: dto.status, updatedAt: new Date() })
      .where(eq(users.id, target.id))
      .returning();

    await this.audit.record({
      actorUserId: actor.id,
      action: 'admin.user_status_changed',
      entityType: 'user',
      entityId: target.id,
      metadata: {
        targetEmail: target.email,
        from: target.status,
        to: dto.status,
        ...(dto.reason ? { reason: dto.reason } : {}),
      },
      ipAddress: context.ip,
      userAgent: context.userAgent,
    });
    return this.toPublic(updated ?? target);
  }

  // ── Store oversight (read-only in the MVP) ───────────────────────

  async listStores(): Promise<AdminStoreRow[]> {
    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const [storeRows, staffCounts, productCounts, orderStats] = await Promise.all([
      this.database.db.select().from(stores).orderBy(stores.name),
      this.database.db
        .select({ storeId: storeStaff.storeId, n: count() })
        .from(storeStaff)
        .groupBy(storeStaff.storeId),
      this.database.db
        .select({ storeId: products.storeId, n: count() })
        .from(products)
        .groupBy(products.storeId),
      this.database.db
        .select({
          storeId: orders.storeId,
          totalOrders: count(),
          todayOrders:
            sql<number>`count(*) filter (where ${gte(orders.createdAt, startOfToday)})`.mapWith(
              Number,
            ),
          todayRevenue:
            sql<number>`coalesce(sum(${orders.total}) filter (where ${gte(orders.paidAt, startOfToday)} and ${notInArray(orders.status, REVENUE_LOST_STATUSES)}), 0)`.mapWith(
              Number,
            ),
        })
        .from(orders)
        .groupBy(orders.storeId),
    ]);

    const staffByStore = new Map(staffCounts.map((row) => [row.storeId, row.n]));
    const productsByStore = new Map(productCounts.map((row) => [row.storeId, row.n]));
    const ordersByStore = new Map(orderStats.map((row) => [row.storeId, row]));

    return storeRows.map((store: Store) => {
      const o = ordersByStore.get(store.id);
      return {
        id: store.id,
        name: store.name,
        code: store.code,
        status: store.status,
        city: store.city,
        state: store.state,
        staffCount: staffByStore.get(store.id) ?? 0,
        productCount: productsByStore.get(store.id) ?? 0,
        totalOrders: o?.totalOrders ?? 0,
        todayOrders: o?.todayOrders ?? 0,
        todayRevenue: o?.todayRevenue ?? 0,
        createdAt: store.createdAt.toISOString(),
      };
    });
  }

  // ── Order oversight (read-only; fulfillment stays in /bokku) ─────

  listOrders(query: ListAdminOrdersQuery): Promise<Paginated<PublicOrderSummary>> {
    return this.ordersService.listAll(query);
  }

  getOrder(orderId: string): Promise<PublicOrderDetail> {
    return this.ordersService.getAny(orderId);
  }

  /** Lifecycle lever: non-ACTIVE stores refuse new business at checkout. */
  async updateStoreStatus(
    actor: User,
    storeId: string,
    dto: UpdateAdminStoreStatusDto,
    context: AdminRequestContext,
  ): Promise<AdminStoreRow> {
    const [store] = await this.database.db
      .select()
      .from(stores)
      .where(eq(stores.id, storeId))
      .limit(1);
    if (!store) {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'Store was not found' });
    }
    if (store.status === dto.status) {
      const rows = await this.listStores();
      return rows.find((row) => row.id === store.id)!; // idempotent no-op
    }

    await this.database.db
      .update(stores)
      .set({ status: dto.status, updatedAt: new Date() })
      .where(eq(stores.id, store.id));

    await this.audit.record({
      actorUserId: actor.id,
      action: 'admin.store_status_changed',
      entityType: 'store',
      entityId: store.id,
      metadata: {
        storeCode: store.code,
        from: store.status,
        to: dto.status,
        ...(dto.reason ? { reason: dto.reason } : {}),
      },
      ipAddress: context.ip,
      userAgent: context.userAgent,
    });

    const rows = await this.listStores();
    return rows.find((row) => row.id === store.id)!;
  }

  /**
   * The ONLY refund-state mutation: retry the provider refund for an
   * order stuck in REFUND_PENDING (a provider outage earlier left it
   * there — the cancel flow never pretends success). Already-refunded
   * orders return as-is; everything else is a 409. The refund itself is
   * idempotent at the payment layer.
   */
  async retryOrderRefund(
    actor: User,
    orderId: string,
    context: AdminRequestContext,
  ): Promise<PublicOrderDetail> {
    const order = await this.ordersService.getRowById(orderId);
    if (order.status === 'REFUNDED') return this.ordersService.getAny(orderId);
    if (order.status !== 'REFUND_PENDING') {
      throw new ConflictException({
        code: 'ORDER_REFUND_NOT_PENDING',
        message: `Only orders in REFUND_PENDING can be retried (status is ${order.status})`,
      });
    }

    const [payment] = await this.database.db
      .select()
      .from(payments)
      .where(eq(payments.id, order.paymentId))
      .limit(1);
    if (!payment) {
      throw new ConflictException({
        code: 'ORDER_REFUND_NOT_PENDING',
        message: 'This order has no payment on record to refund',
      });
    }

    try {
      const refunded = await this.paymentsService.refundById(payment.id);
      const detail = await this.ordersService.transitionSystem(orderId, 'REFUNDED', {
        reference: refunded.reference,
      });
      await this.audit.record({
        actorUserId: actor.id,
        action: 'admin.refund_retried',
        entityType: 'order',
        entityId: order.id,
        metadata: { orderNumber: order.orderNumber, reference: refunded.reference },
        ipAddress: context.ip,
        userAgent: context.userAgent,
      });
      return detail;
    } catch (error) {
      if (error instanceof PaymentIntegrationError) {
        await this.audit.record({
          actorUserId: actor.id,
          action: 'admin.refund_retry_failed',
          entityType: 'order',
          entityId: order.id,
          metadata: {
            orderNumber: order.orderNumber,
            reference: payment.reference,
            reason: error.message,
          },
          ipAddress: context.ip,
          userAgent: context.userAgent,
        });
        // Provider faults are upstream problems → 502 preserves the code.
        throw new BadGatewayException({ code: error.code, message: error.message });
      }
      throw error;
    }
  }

  // ── Audit trail ─────────────────────────────────────────────────

  async listAuditLogs(query: ListAdminAuditLogsQuery): Promise<Paginated<AdminAuditLog>> {
    const { page, limit, offset } = parsePagination(query);
    const filters: SQL[] = [];
    if (query.action?.trim()) {
      const escaped = escapeIlike(query.action.trim());
      filters.push(ilike(auditLogs.action, `${escaped}%`));
    }
    if (query.actorId) filters.push(eq(auditLogs.actorUserId, query.actorId));
    if (query.from) filters.push(gte(auditLogs.createdAt, new Date(query.from)));
    if (query.to) filters.push(lte(auditLogs.createdAt, new Date(query.to)));
    const where = filters.length > 0 ? and(...filters) : undefined;

    const [rows, countRows] = await Promise.all([
      this.database.db
        .select({ log: auditLogs, actor: users })
        .from(auditLogs)
        .leftJoin(users, eq(users.id, auditLogs.actorUserId))
        .where(where)
        .orderBy(desc(auditLogs.createdAt))
        .limit(limit)
        .offset(offset),
      this.database.db.select({ total: count() }).from(auditLogs).where(where),
    ]);
    const total = countRows[0]?.total ?? 0;
    return {
      data: rows.map(({ log, actor }) => ({
        id: log.id,
        action: log.action,
        entityType: log.entityType,
        entityId: log.entityId,
        actor: actor
          ? {
              id: actor.id,
              email: actor.email,
              firstName: actor.firstName,
              lastName: actor.lastName,
              role: actor.role,
            }
          : null,
        metadata: (log.metadata as Record<string, unknown> | null) ?? null,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        createdAt: log.createdAt.toISOString(),
      })),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────

  private async requireUser(userId: string): Promise<User> {
    const [user] = await this.database.db
      .select()
      .from(users)
      .where(and(eq(users.id, userId), isNull(users.deletedAt)))
      .limit(1);
    if (!user) {
      throw new NotFoundException({ code: 'USER_NOT_FOUND', message: 'User was not found' });
    }
    return user;
  }

  /**
   * Lockout protection: refuse to demote/suspend the target when no OTHER
   * ACTIVE PLATFORM_ADMIN would remain. (Defense in depth — via the API
   * the caller is themselves an active admin, so this mainly guards
   * direct service calls and future bulk paths.)
   */
  private async assertOtherActiveAdminExists(target: User): Promise<void> {
    const [row] = await this.database.db
      .select({ n: count() })
      .from(users)
      .where(
        and(
          eq(users.role, 'PLATFORM_ADMIN'),
          eq(users.status, 'ACTIVE'),
          isNull(users.deletedAt),
          ne(users.id, target.id),
        ),
      );
    if ((row?.n ?? 0) < 1) {
      throw new ConflictException({
        code: 'ADMIN_LAST_PLATFORM_ADMIN',
        message: 'This is the only active platform admin — promote another admin first',
      });
    }
  }

  private async requireBokkuStore(): Promise<Store> {
    const [store] = await this.database.db
      .select()
      .from(stores)
      .where(eq(stores.code, BOKKU_STORE_CODE))
      .limit(1);
    if (!store) {
      throw new InternalServerErrorException({
        code: 'STORE_NOT_CONFIGURED',
        message: 'The Bokku store is not configured yet',
      });
    }
    return store;
  }

  private toPublic(user: User): PublicUser {
    return {
      id: user.id,
      email: user.email,
      phone: user.phone,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      status: user.status,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
    };
  }
}

/** ILIKE user-search over email + name. `escapeIlike` keeps %/_ literal. */
function ilikeFilter(term: string): SQL {
  const pattern = `%${escapeIlike(term)}%`;
  return or(
    ilike(users.email, pattern),
    ilike(users.firstName, pattern),
    ilike(users.lastName, pattern),
  ) as SQL;
}

function escapeIlike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}
