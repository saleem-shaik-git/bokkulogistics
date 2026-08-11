import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, gte, sql } from 'drizzle-orm';
import { inventory, products, type DatabaseConnection } from '@bokku/database';

import { DRIZZLE_CLIENT } from '../../config/constants';

/** A drizzle transaction (what `db.transaction(async (tx) => …)` yields). */
export type DbTransaction = Parameters<Parameters<DatabaseConnection['db']['transaction']>[0]>[0];

export interface ReservationLine {
  productId: string;
  quantity: number;
}

export interface InventoryRow {
  productId: string;
  productName: string;
  sku: string;
  quantityOnHand: number;
  reservedQuantity: number;
  sellable: number;
  lowStockThreshold: number;
  lowStock: boolean;
}

export interface InventoryAdjustment {
  /** Signed delta (may be negative). Mutually exclusive with setQuantity. */
  adjustment?: number;
  /** Absolute new on-hand value. Mutually exclusive with adjustment. */
  setQuantity?: number;
  lowStockThreshold?: number;
  reason: string;
}

export interface AdjustmentResult {
  productId: string;
  previousQuantityOnHand: number;
  quantityOnHand: number;
  lowStockThreshold: number;
}

/**
 * Stock authority. All writes run inside a transaction with a
 * SELECT … FOR UPDATE row lock, and the final value is validated —
 * stock can NEVER go negative (belt: app check; braces: DB CHECK constraint).
 */
@Injectable()
export class InventoryService {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly database: DatabaseConnection) {}

  async listForStore(storeId: string): Promise<InventoryRow[]> {
    const rows = await this.database.db
      .select({
        productId: products.id,
        productName: products.name,
        sku: products.sku,
        quantityOnHand: inventory.quantityOnHand,
        reservedQuantity: inventory.reservedQuantity,
        lowStockThreshold: products.lowStockThreshold,
      })
      .from(inventory)
      .innerJoin(products, eq(inventory.productId, products.id))
      .where(eq(inventory.storeId, storeId))
      .orderBy(asc(products.name));

    return rows.map((row) => ({
      ...row,
      sellable: row.quantityOnHand - row.reservedQuantity,
      lowStock: row.quantityOnHand <= row.lowStockThreshold,
    }));
  }

  /**
   * Reserve stock for an order's lines (payment captured / order creation).
   * Each line is a single conditional UPDATE guarded by
   * `quantity_on_hand - reserved_quantity - qty >= 0` — concurrent orders
   * can never oversell, and sellable stock can never go negative.
   * Runs inside the caller's transaction so failures roll back atomically.
   */
  async reserve(lines: ReservationLine[], storeId: string, tx: DbTransaction): Promise<void> {
    for (const line of lines) {
      const updated = await tx
        .update(inventory)
        .set({
          reservedQuantity: sql`${inventory.reservedQuantity} + ${line.quantity}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(inventory.productId, line.productId),
            eq(inventory.storeId, storeId),
            gte(inventory.quantityOnHand, sql`${inventory.reservedQuantity} + ${line.quantity}`),
          ),
        )
        .returning({ id: inventory.id });
      if (updated.length === 0) {
        throw new ConflictException({
          code: 'INSUFFICIENT_STOCK',
          message: `Not enough stock to reserve ${line.quantity} unit(s) — another order may have taken them`,
        });
      }
    }
  }

  /** Release a reservation (order cancellation before fulfillment). */
  async releaseReservation(
    lines: ReservationLine[],
    storeId: string,
    tx: DbTransaction,
  ): Promise<void> {
    for (const line of lines) {
      const updated = await tx
        .update(inventory)
        .set({
          reservedQuantity: sql`${inventory.reservedQuantity} - ${line.quantity}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(inventory.productId, line.productId),
            eq(inventory.storeId, storeId),
            gte(inventory.reservedQuantity, line.quantity),
          ),
        )
        .returning({ id: inventory.id });
      if (updated.length === 0) {
        throw new ConflictException({
          code: 'RESERVATION_INCONSISTENT',
          message: 'Reserved stock bookkeeping is inconsistent for this order',
        });
      }
    }
  }

  /** Settle at fulfillment: on-hand AND reserved both drop by the line quantity. */
  async settleReservation(
    lines: ReservationLine[],
    storeId: string,
    tx: DbTransaction,
  ): Promise<void> {
    for (const line of lines) {
      const updated = await tx
        .update(inventory)
        .set({
          quantityOnHand: sql`${inventory.quantityOnHand} - ${line.quantity}`,
          reservedQuantity: sql`${inventory.reservedQuantity} - ${line.quantity}`,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(inventory.productId, line.productId),
            eq(inventory.storeId, storeId),
            gte(inventory.quantityOnHand, line.quantity),
            gte(inventory.reservedQuantity, line.quantity),
          ),
        )
        .returning({ id: inventory.id });
      if (updated.length === 0) {
        throw new ConflictException({
          code: 'RESERVATION_INCONSISTENT',
          message: 'Reserved stock bookkeeping is inconsistent for this order',
        });
      }
    }
  }

  async adjust(productId: string, input: InventoryAdjustment): Promise<AdjustmentResult> {
    if (input.adjustment === undefined && input.setQuantity === undefined) {
      throw new BadRequestException({
        code: 'ADJUSTMENT_REQUIRED',
        message: 'Provide either adjustment or setQuantity',
      });
    }
    if (input.adjustment !== undefined && input.setQuantity !== undefined) {
      throw new BadRequestException({
        code: 'ADJUSTMENT_CONFLICT',
        message: 'Provide only one of adjustment or setQuantity',
      });
    }

    return this.database.db.transaction(async (tx) => {
      const [locked] = await tx
        .select({
          inventory,
          lowStockThreshold: products.lowStockThreshold,
        })
        .from(inventory)
        .innerJoin(products, eq(inventory.productId, products.id))
        .where(eq(inventory.productId, productId))
        .for('update')
        .limit(1);
      if (!locked) {
        throw new NotFoundException({
          code: 'INVENTORY_NOT_FOUND',
          message: 'No inventory exists for this product',
        });
      }

      const next =
        input.setQuantity !== undefined
          ? input.setQuantity
          : locked.inventory.quantityOnHand + (input.adjustment ?? 0);

      if (!Number.isInteger(next) || next < 0) {
        throw new ConflictException({
          code: 'INSUFFICIENT_STOCK',
          message: `Stock cannot become negative (current ${locked.inventory.quantityOnHand})`,
        });
      }
      if (next < locked.inventory.reservedQuantity) {
        throw new ConflictException({
          code: 'STOCK_RESERVED',
          message: `${locked.inventory.reservedQuantity} units are reserved by open orders`,
        });
      }

      const [updated] = await tx
        .update(inventory)
        .set({ quantityOnHand: next, updatedAt: new Date() })
        .where(eq(inventory.id, locked.inventory.id))
        .returning();

      let lowStockThreshold = locked.lowStockThreshold;
      if (input.lowStockThreshold !== undefined && input.lowStockThreshold !== lowStockThreshold) {
        const [updatedProduct] = await tx
          .update(products)
          .set({ lowStockThreshold: input.lowStockThreshold, updatedAt: new Date() })
          .where(eq(products.id, productId))
          .returning({ lowStockThreshold: products.lowStockThreshold });
        lowStockThreshold = updatedProduct?.lowStockThreshold ?? lowStockThreshold;
      }

      return {
        productId,
        previousQuantityOnHand: locked.inventory.quantityOnHand,
        quantityOnHand: updated!.quantityOnHand,
        lowStockThreshold,
      };
    });
  }
}
