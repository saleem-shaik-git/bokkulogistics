import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, isNull } from 'drizzle-orm';
import {
  categories,
  inventory,
  payments,
  products,
  type DatabaseConnection,
  type Product,
  type Store,
  type User,
} from '@bokku/database';
import type { Paginated, PublicOrderDetail, PublicOrderSummary } from '@bokku/shared';

import { DRIZZLE_CLIENT } from '../../config/constants';
import { AuditService } from '../audit/audit.module';
import {
  buildPaginationMeta,
  parsePagination,
  type PaginationQuery,
} from '../../common/pagination';
import { slugify, withSuffix } from '../../common/utils/slugify';
import { OrdersService } from '../orders/orders.service';
import type { ListOrdersQuery, TransitionOrderStatusDto } from '../orders/dto/orders.dto';
import { PaymentsService } from '../payments/payments.service';
import type { CreateProductDto, UpdateProductDto } from './dto/bokku.dto';

/** Catalogue + order management for the Bokku operations dashboard. */
@Injectable()
export class BokkuService {
  private readonly logger = new Logger(BokkuService.name);

  constructor(
    @Inject(DRIZZLE_CLIENT) private readonly database: DatabaseConnection,
    private readonly audit: AuditService,
    private readonly orders: OrdersService,
    private readonly paymentsService: PaymentsService,
  ) {}

  async listProducts(store: Store, query: PaginationQuery): Promise<Paginated<Product>> {
    const { page, limit, offset } = parsePagination(query);
    const where = and(eq(products.storeId, store.id), isNull(products.deletedAt));
    const [rows, countRows] = await Promise.all([
      this.database.db
        .select()
        .from(products)
        .where(where)
        .orderBy(desc(products.createdAt))
        .limit(limit)
        .offset(offset),
      this.database.db.select({ total: count() }).from(products).where(where),
    ]);
    const total = countRows[0]?.total ?? 0;
    return { data: rows, meta: buildPaginationMeta(total, page, limit) };
  }

  async createProduct(store: Store, dto: CreateProductDto, actor: User): Promise<Product> {
    await this.requireCategory(store.id, dto.categoryId);

    const sku = dto.sku?.trim() || this.generateSku(dto.name);
    const baseSlug = slugify(dto.name);

    const created = await this.database.db.transaction(async (tx) => {
      // A few slug attempts absorb races on the (storeId, slug) constraint.
      let product: Product | undefined;
      let lastError: unknown;
      for (let attempt = 0; attempt < 3 && !product; attempt++) {
        const slug = attempt === 0 ? baseSlug : withSuffix(baseSlug);
        try {
          const [row] = await tx
            .insert(products)
            .values({
              storeId: store.id,
              categoryId: dto.categoryId,
              name: dto.name.trim(),
              slug,
              description: dto.description?.trim() || null,
              sku,
              price: dto.price,
              lowStockThreshold: dto.lowStockThreshold ?? 5,
              imageUrl: dto.imageUrl || null,
              status: dto.status ?? 'ACTIVE',
            })
            .returning();
          product = row;
        } catch (error) {
          lastError = error;
          if (this.hasViolated(error, 'products_store_sku_unique')) {
            throw new ConflictException({
              code: 'SKU_ALREADY_EXISTS',
              message: `SKU "${sku}" already exists in this store`,
            });
          }
          if (!this.hasViolated(error, 'products_store_slug_unique')) throw error;
        }
      }
      if (!product) throw lastError;

      await tx.insert(inventory).values({
        storeId: store.id,
        productId: product.id,
        quantityOnHand: dto.initialStock ?? 0,
      });
      return product;
    });

    await this.audit.record({
      actorUserId: actor.id,
      action: 'product.created',
      entityType: 'product',
      entityId: created.id,
      metadata: { name: created.name, sku: created.sku, price: created.price },
    });
    return created;
  }

  async updateProduct(
    store: Store,
    productId: string,
    dto: UpdateProductDto,
    actor: User,
  ): Promise<Product> {
    const [existing] = await this.database.db
      .select()
      .from(products)
      .where(
        and(eq(products.id, productId), eq(products.storeId, store.id), isNull(products.deletedAt)),
      )
      .limit(1);
    if (!existing) {
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product was not found' });
    }
    if (dto.categoryId && dto.categoryId !== existing.categoryId) {
      await this.requireCategory(store.id, dto.categoryId);
    }

    const patch: Partial<typeof products.$inferInsert> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name.trim();
    if (dto.categoryId !== undefined) patch.categoryId = dto.categoryId;
    if (dto.description !== undefined) patch.description = dto.description?.trim() || null;
    if (dto.price !== undefined) patch.price = dto.price;
    if (dto.imageUrl !== undefined) patch.imageUrl = dto.imageUrl || null;
    if (dto.lowStockThreshold !== undefined) patch.lowStockThreshold = dto.lowStockThreshold;
    if (dto.status !== undefined) patch.status = dto.status;

    const [updated] = await this.database.db
      .update(products)
      .set(patch)
      .where(eq(products.id, existing.id))
      .returning();

    if (dto.price !== undefined && dto.price !== existing.price) {
      await this.audit.record({
        actorUserId: actor.id,
        action: 'product.price_changed',
        entityType: 'product',
        entityId: existing.id,
        metadata: { before: existing.price, after: dto.price },
      });
    }
    if (dto.status !== undefined && dto.status !== existing.status) {
      await this.audit.record({
        actorUserId: actor.id,
        action: 'product.status_changed',
        entityType: 'product',
        entityId: existing.id,
        metadata: { before: existing.status, after: dto.status },
      });
    }
    return updated!;
  }

  /** 404s if the category does not exist within this store (no cross-store writes). */
  private async requireCategory(storeId: string, categoryId: string): Promise<void> {
    const [category] = await this.database.db
      .select({ id: categories.id })
      .from(categories)
      .where(and(eq(categories.id, categoryId), eq(categories.storeId, storeId)))
      .limit(1);
    if (!category) {
      throw new NotFoundException({
        code: 'CATEGORY_NOT_FOUND',
        message: 'Category was not found in this store',
      });
    }
  }

  private generateSku(name: string): string {
    const prefix = slugify(name).slice(0, 20).toUpperCase().replace(/-/g, '');
    const suffix = Math.random().toString(36).slice(2, 8).toUpperCase();
    return `${prefix || 'PRD'}-${suffix}`;
  }

  /** True when the thrown driver error is a unique violation on the given constraint. */
  private hasViolated(error: unknown, constraint: string): boolean {
    let current: unknown = error;
    while (typeof current === 'object' && current !== null) {
      const candidate = current as { code?: string; constraint_name?: string; message?: string };
      if (
        candidate.code === '23505' &&
        (candidate.constraint_name === constraint || (candidate.message ?? '').includes(constraint))
      ) {
        return true;
      }
      current = (current as { cause?: unknown }).cause;
    }
    return false;
  }

  // ── Order operations (Phase 7) ──────────────────────────────────

  listOrders(store: Store, query: ListOrdersQuery): Promise<Paginated<PublicOrderSummary>> {
    return this.orders.listForStore(store.id, query);
  }

  getOrder(store: Store, orderId: string): Promise<PublicOrderDetail> {
    return this.orders.getForStore(store.id, orderId);
  }

  /**
   * Staff order operations. Normal progressions go straight through the
   * state policy. Cancellation additionally runs the refund path:
   * release stock (inside the transition) → REFUND_PENDING → provider
   * refund → REFUNDED. A failed refund leaves the order REFUND_PENDING
   * (never silently "refunded") for ops to retry.
   */
  async transitionOrder(
    store: Store,
    orderId: string,
    dto: TransitionOrderStatusDto,
    actor: User,
  ): Promise<PublicOrderDetail> {
    if (dto.status !== 'CANCELLED') {
      if (dto.status === 'REFUNDED' || dto.status === 'REFUND_PENDING') {
        throw new ConflictException({
          code: 'ORDER_INVALID_TRANSITION',
          message: 'Refund statuses are driven by the refund flow, not set directly',
        });
      }
      return this.orders.transitionForStore(store.id, orderId, dto.status, dto.reason, actor);
    }

    await this.orders.transitionForStore(store.id, orderId, 'CANCELLED', dto.reason, actor);

    // Refund path for orders with a successful payment.
    const row = await this.orders.getRowById(orderId);
    const [payment] = await this.database.db
      .select()
      .from(payments)
      .where(eq(payments.id, row.paymentId))
      .limit(1);

    if (payment?.status === 'SUCCESS') {
      await this.orders.transitionSystem(orderId, 'REFUND_PENDING', { actor: actor.id });
      try {
        await this.paymentsService.refundById(payment.id);
        await this.orders.transitionSystem(orderId, 'REFUNDED', { reference: payment.reference });
      } catch (error) {
        this.logger.error(
          `Refund failed for order ${row.orderNumber} (${payment.reference}) — stays REFUND_PENDING`,
          error as Error,
        );
      }
    }
    return this.orders.getForStore(store.id, orderId);
  }
}
