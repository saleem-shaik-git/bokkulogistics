import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, count, desc, eq, ilike, isNull, or, type SQL, sql } from 'drizzle-orm';
import {
  categories,
  inventory,
  productImages,
  products,
  type DatabaseConnection,
  type Product,
  type ProductImage,
} from '@bokku/database';
import type {
  Paginated,
  PublicProductDetail,
  PublicProductImage,
  PublicProductListItem,
} from '@bokku/shared';

import { DRIZZLE_CLIENT } from '../../config/constants';
import {
  buildPaginationMeta,
  parsePagination,
  type PaginationQuery,
} from '../../common/pagination';
import { StoresService } from '../stores/stores.service';

export interface ListProductsQuery extends PaginationQuery {
  /** Free-text search over name and description. */
  q?: string;
  /** Filter by category — accepts the category id or its slug. */
  category?: string;
}

/** Sellable units = on hand − reserved. Expressed once, reused everywhere. */
const SELLABLE_SQL = sql<number>`coalesce(${inventory.quantityOnHand}, 0) - coalesce(${inventory.reservedQuantity}, 0)`;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class ProductsService {
  constructor(
    @Inject(DRIZZLE_CLIENT) private readonly database: DatabaseConnection,
    private readonly storesService: StoresService,
  ) {}

  async listForStore(
    storeId: string,
    query: ListProductsQuery,
  ): Promise<Paginated<PublicProductListItem>> {
    await this.storesService.requireActiveStore(storeId);
    const { page, limit, offset } = parsePagination(query);

    const filters: SQL[] = [
      eq(products.storeId, storeId),
      eq(products.status, 'ACTIVE'),
      isNull(products.deletedAt),
    ];
    if (query.category) {
      // Slug always matches by text; id only when it's actually a UUID
      // (a non-UUID would otherwise crash the uuid comparison with a 500).
      const categoryFilters: SQL[] = [eq(categories.slug, query.category)];
      if (UUID_REGEX.test(query.category)) {
        categoryFilters.push(eq(categories.id, query.category));
      }
      filters.push(or(...categoryFilters)!);
    }
    if (query.q?.trim()) {
      const pattern = `%${escapeLikePattern(query.q.trim())}%`;
      filters.push(or(ilike(products.name, pattern), ilike(products.description, pattern))!);
    }
    const where = and(...filters);

    const [rows, countRows] = await Promise.all([
      this.database.db
        .select({
          product: products,
          categoryName: categories.name,
          categorySlug: categories.slug,
          sellable: SELLABLE_SQL.mapWith(Number),
        })
        .from(products)
        .innerJoin(categories, eq(products.categoryId, categories.id))
        .leftJoin(inventory, eq(inventory.productId, products.id))
        .where(where)
        .orderBy(desc(products.createdAt), asc(products.name))
        .limit(limit)
        .offset(offset),
      this.database.db
        .select({ total: count() })
        .from(products)
        .innerJoin(categories, eq(products.categoryId, categories.id))
        .where(where),
    ]);
    const total = countRows[0]?.total ?? 0;

    return {
      data: rows.map((row) =>
        this.toListItem(row.product, row.categoryName, row.categorySlug, row.sellable),
      ),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async getPublicById(id: string): Promise<PublicProductDetail> {
    const [row] = await this.database.db
      .select({
        product: products,
        categoryName: categories.name,
        categorySlug: categories.slug,
        sellable: SELLABLE_SQL.mapWith(Number),
      })
      .from(products)
      .innerJoin(categories, eq(products.categoryId, categories.id))
      .leftJoin(inventory, eq(inventory.productId, products.id))
      .where(and(eq(products.id, id), eq(products.status, 'ACTIVE'), isNull(products.deletedAt)))
      .limit(1);

    if (!row) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: 'Product was not found',
      });
    }
    await this.storesService.requireActiveStore(row.product.storeId);

    const images = await this.database.db
      .select()
      .from(productImages)
      .where(eq(productImages.productId, id))
      .orderBy(asc(productImages.sortOrder));

    return {
      ...this.toListItem(row.product, row.categoryName, row.categorySlug, row.sellable),
      sku: row.product.sku,
      lowStockThreshold: row.product.lowStockThreshold,
      images: this.toPublicImages(row.product, images),
      createdAt: row.product.createdAt.toISOString(),
    };
  }

  private toListItem(
    product: Product,
    categoryName: string,
    categorySlug: string,
    sellable: number,
  ): PublicProductListItem {
    return {
      id: product.id,
      storeId: product.storeId,
      categoryId: product.categoryId,
      categoryName,
      categorySlug,
      name: product.name,
      slug: product.slug,
      description: product.description,
      price: product.price,
      imageUrl: product.imageUrl,
      status: product.status,
      stockQuantity: sellable,
      available: product.status === 'ACTIVE' && sellable > 0,
    };
  }

  private toPublicImages(product: Product, images: ProductImage[]): PublicProductImage[] {
    const gallery = images.map((image) => ({
      id: image.id,
      url: image.url,
      altText: image.altText,
      sortOrder: image.sortOrder,
    }));
    // Synthesize a gallery from the cover when no product_images rows exist.
    if (gallery.length === 0 && product.imageUrl) {
      return [{ id: 'cover', url: product.imageUrl, altText: product.name, sortOrder: 0 }];
    }
    return gallery;
  }
}

/** Escape LIKE/ILIKE wildcards so user search input is matched literally. */
function escapeLikePattern(input: string): string {
  return input.replace(/[\\%_]/g, (char) => `\\${char}`);
}
