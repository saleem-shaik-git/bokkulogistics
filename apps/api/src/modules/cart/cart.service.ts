import {
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import {
  cartItems,
  carts,
  inventory,
  products,
  type Cart,
  type CartItem,
  type DatabaseConnection,
  type Product,
} from '@bokku/database';
import { EMPTY_CART, type PublicCart, type PublicCartLine } from '@bokku/shared';

import { DRIZZLE_CLIENT } from '../../config/constants';
import { SELLABLE_SQL } from '../products/products.service';
import type { AddCartItemDto, UpdateCartItemDto } from './dto/cart.dto';

/**
 * Customer cart. Invariants enforced here:
 *  - one cart per user, locked to a single store;
 *  - only ACTIVE, non-deleted products can be added;
 *  - quantity checks are serialized on the product's inventory row so two
 *    concurrent cart mutations cannot both validate against stale stock;
 *  - prices/totals are computed from the products table on every read.
 *
 * Checkout remains the final inventory authority: cart quantities are intent,
 * while checkout/order conversion performs the conditional stock reservation.
 */
@Injectable()
export class CartService {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly database: DatabaseConnection) {}

  /** The user's cart with live prices and stock. Empty cart when none exists. */
  async getCart(userId: string): Promise<PublicCart> {
    const cart = await this.findCart(userId);
    if (!cart) return EMPTY_CART;

    const rows = await this.database.db
      .select({
        item: cartItems,
        product: products,
        sellable: SELLABLE_SQL.mapWith(Number),
      })
      .from(cartItems)
      .innerJoin(products, eq(cartItems.productId, products.id))
      .leftJoin(inventory, eq(inventory.productId, products.id))
      .where(eq(cartItems.cartId, cart.id))
      .orderBy(asc(cartItems.createdAt));

    const lines = rows.map((row) => this.toLine(row.item, row.product, row.sellable));
    return {
      id: cart.id,
      storeId: cart.storeId,
      items: lines,
      itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
      subtotal: lines.reduce((sum, line) => sum + line.lineTotal, 0),
    };
  }

  /** Add (or merge into) a cart line. Creates the cart lazily on first add. */
  async addItem(userId: string, dto: AddCartItemDto): Promise<PublicCart> {
    const { product } = await this.requirePurchasableProduct(dto.productId);
    const cart = await this.getOrCreateCart(userId, product.storeId);

    if (cart.storeId !== product.storeId) {
      throw new ConflictException({
        code: 'CART_STORE_CONFLICT',
        message: 'Your cart contains items from another store. Clear it to shop here.',
      });
    }

    await this.database.db.transaction(async (tx) => {
      // Serialize cart mutations for this product against inventory changes.
      // The checkout reservation still remains the authoritative stock guard.
      const [stock] = await tx
        .select({
          inventory: inventory,
          sellable: sql<number>`${inventory.quantityOnHand} - ${inventory.reservedQuantity}`,
        })
        .from(inventory)
        .where(and(eq(inventory.productId, product.id), eq(inventory.storeId, product.storeId)))
        .for('update')
        .limit(1);

      const sellable = Number(stock?.sellable ?? 0);
      const [existing] = await tx
        .select()
        .from(cartItems)
        .where(and(eq(cartItems.cartId, cart.id), eq(cartItems.productId, product.id)))
        .limit(1);

      this.assertPurchasable(product, sellable, (existing?.quantity ?? 0) + dto.quantity);

      await tx
        .insert(cartItems)
        .values({ cartId: cart.id, productId: product.id, quantity: dto.quantity })
        .onConflictDoUpdate({
          target: [cartItems.cartId, cartItems.productId],
          set: {
            quantity: sql`${cartItems.quantity} + ${dto.quantity}`,
            updatedAt: new Date(),
          },
        });
    });

    return this.getCart(userId);
  }

  /** Set the exact quantity of a cart line owned by the user. */
  async updateItem(userId: string, itemId: string, dto: UpdateCartItemDto): Promise<PublicCart> {
    const line = await this.findOwnedLine(userId, itemId);
    const { product } = await this.requirePurchasableProduct(line.productId);

    await this.database.db.transaction(async (tx) => {
      const [stock] = await tx
        .select({
          inventory: inventory,
          sellable: sql<number>`${inventory.quantityOnHand} - ${inventory.reservedQuantity}`,
        })
        .from(inventory)
        .where(and(eq(inventory.productId, product.id), eq(inventory.storeId, product.storeId)))
        .for('update')
        .limit(1);

      const sellable = Number(stock?.sellable ?? 0);
      this.assertPurchasable(product, sellable, dto.quantity);

      await tx
        .update(cartItems)
        .set({ quantity: dto.quantity, updatedAt: new Date() })
        .where(eq(cartItems.id, line.id));
    });

    return this.getCart(userId);
  }

  /** Remove one line from the user's cart (404 when not theirs — no IDOR). */
  async removeItem(userId: string, itemId: string): Promise<PublicCart> {
    const line = await this.findOwnedLine(userId, itemId);
    await this.database.db.delete(cartItems).where(eq(cartItems.id, line.id));
    return this.getCart(userId);
  }

  /** Delete the whole cart (lines cascade). Idempotent. */
  async clearCart(userId: string): Promise<{ cleared: boolean }> {
    const cart = await this.findCart(userId);
    if (cart) {
      await this.database.db.delete(carts).where(eq(carts.id, cart.id));
    }
    return { cleared: true };
  }

  private async findCart(userId: string): Promise<Cart | null> {
    const [cart] = await this.database.db
      .select()
      .from(carts)
      .where(eq(carts.userId, userId))
      .limit(1);
    return cart ?? null;
  }

  private async getOrCreateCart(userId: string, storeId: string): Promise<Cart> {
    const existing = await this.findCart(userId);
    if (existing) return existing;

    const [created] = await this.database.db
      .insert(carts)
      .values({ userId, storeId })
      .onConflictDoNothing({ target: carts.userId })
      .returning();
    if (created) return created;

    const cart = await this.findCart(userId);
    if (!cart) throw new InternalServerErrorException('Cart could not be created');
    return cart;
  }

  private async requirePurchasableProduct(
    productId: string,
  ): Promise<{ product: Product; sellable: number }> {
    const [row] = await this.database.db
      .select({ product: products, sellable: SELLABLE_SQL.mapWith(Number) })
      .from(products)
      .leftJoin(inventory, eq(inventory.productId, products.id))
      .where(and(eq(products.id, productId), isNull(products.deletedAt)))
      .limit(1);
    if (!row) {
      throw new NotFoundException({ code: 'PRODUCT_NOT_FOUND', message: 'Product was not found' });
    }
    return row;
  }

  private async findOwnedLine(userId: string, itemId: string): Promise<CartItem> {
    const [row] = await this.database.db
      .select({ item: cartItems })
      .from(cartItems)
      .innerJoin(carts, eq(cartItems.cartId, carts.id))
      .where(and(eq(cartItems.id, itemId), eq(carts.userId, userId)))
      .limit(1);
    if (!row) {
      throw new NotFoundException({
        code: 'CART_ITEM_NOT_FOUND',
        message: 'Cart item was not found',
      });
    }
    return row.item;
  }

  private assertPurchasable(product: Product, sellable: number, requestedQuantity: number): void {
    if (product.status !== 'ACTIVE') {
      throw new ConflictException({
        code: 'PRODUCT_UNAVAILABLE',
        message: 'This product is currently unavailable',
      });
    }
    if (sellable <= 0) {
      throw new ConflictException({
        code: 'OUT_OF_STOCK',
        message: `${product.name} is out of stock`,
      });
    }
    if (requestedQuantity > sellable) {
      throw new ConflictException({
        code: 'INSUFFICIENT_STOCK',
        message: `Only ${sellable} unit${sellable === 1 ? '' : 's'} of ${product.name} left in stock`,
      });
    }
  }

  private toLine(item: CartItem, product: Product, sellable: number): PublicCartLine {
    return {
      id: item.id,
      productId: product.id,
      name: product.name,
      slug: product.slug,
      sku: product.sku,
      imageUrl: product.imageUrl,
      unitPrice: product.price,
      quantity: item.quantity,
      lineTotal: product.price * item.quantity,
      stockQuantity: sellable,
      available:
        product.status === 'ACTIVE' && product.deletedAt === null && sellable >= item.quantity,
    };
  }
}
