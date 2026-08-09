import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { inventory, products, type DatabaseConnection } from '@bokku/database';

import { DRIZZLE_CLIENT } from '../../config/constants';

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
