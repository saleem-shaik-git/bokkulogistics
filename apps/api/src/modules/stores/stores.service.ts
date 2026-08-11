import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { asc, count, eq } from 'drizzle-orm';
import {
  categories,
  stores,
  type Category,
  type DatabaseConnection,
  type Store,
} from '@bokku/database';

import { DRIZZLE_CLIENT } from '../../config/constants';
import {
  buildPaginationMeta,
  parsePagination,
  type PaginationQuery,
} from '../../common/pagination';
import type { Paginated, PublicCategory, PublicStore } from '@bokku/shared';

@Injectable()
export class StoresService {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly database: DatabaseConnection) {}

  async listActive(query: PaginationQuery): Promise<Paginated<PublicStore>> {
    const { page, limit, offset } = parsePagination(query);
    const where = eq(stores.status, 'ACTIVE');
    const [rows, countRows] = await Promise.all([
      this.database.db
        .select()
        .from(stores)
        .where(where)
        .orderBy(asc(stores.name))
        .limit(limit)
        .offset(offset),
      this.database.db.select({ total: count() }).from(stores).where(where),
    ]);
    const total = countRows[0]?.total ?? 0;
    return {
      data: rows.map((store) => this.toPublic(store)),
      meta: buildPaginationMeta(total, page, limit),
    };
  }

  async getActiveById(id: string): Promise<PublicStore> {
    const [store] = await this.database.db.select().from(stores).where(eq(stores.id, id)).limit(1);
    if (!store || store.status !== 'ACTIVE') {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'Store was not found' });
    }
    return this.toPublic(store);
  }

  async getActiveCategories(storeId: string): Promise<PublicCategory[]> {
    // Verifying the store first gives a correct 404 instead of an empty list.
    await this.getActiveById(storeId);
    const rows = await this.database.db
      .select()
      .from(categories)
      .where(eq(categories.storeId, storeId))
      .orderBy(asc(categories.sortOrder), asc(categories.name));
    return rows.map((category) => this.toPublicCategory(category));
  }

  /** Internal: load an active store row or 404 (used by other modules). */
  async requireActiveStore(id: string): Promise<Store> {
    const [store] = await this.database.db.select().from(stores).where(eq(stores.id, id)).limit(1);
    if (!store || store.status !== 'ACTIVE') {
      throw new NotFoundException({ code: 'STORE_NOT_FOUND', message: 'Store was not found' });
    }
    return store;
  }

  private toPublic(store: Store): PublicStore {
    return {
      id: store.id,
      name: store.name,
      code: store.code,
      description: store.description,
      address: store.address,
      city: store.city,
      state: store.state,
      latitude: store.latitude,
      longitude: store.longitude,
      phone: store.phone,
      status: store.status,
      openingTime: store.openingTime,
      closingTime: store.closingTime,
    };
  }

  private toPublicCategory(category: Category): PublicCategory {
    return {
      id: category.id,
      storeId: category.storeId,
      name: category.name,
      slug: category.slug,
      description: category.description,
      sortOrder: category.sortOrder,
    };
  }
}
