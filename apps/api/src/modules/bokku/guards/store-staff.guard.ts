import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import {
  storeStaff,
  stores,
  type DatabaseConnection,
  type Store,
  type User,
} from '@bokku/database';
import type { Request } from 'express';

import { DRIZZLE_CLIENT } from '../../../config/constants';

export const BOKKU_STORE_CODE = 'BOKKU';

/**
 * Resource-level authorization for the Bokku operations API.
 *
 * Any /bokku/* route operates on the Bokku store (resolved by code).
 * STORE_MANAGER / BOKKU_ADMIN must have a store_staff membership row —
 * changing an id in the URL never grants access to another store.
 * PLATFORM_ADMIN bypasses membership (platform-level support access).
 */
@Injectable()
export class StoreStaffGuard implements CanActivate {
  constructor(@Inject(DRIZZLE_CLIENT) private readonly database: DatabaseConnection) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: User; store?: Store }>();
    const user = req.user;
    if (!user) {
      throw new ForbiddenException({
        code: 'AUTH_ACCESS_DENIED',
        message: 'You do not have permission to access this resource',
      });
    }

    const [store] = await this.database.db
      .select()
      .from(stores)
      .where(eq(stores.code, BOKKU_STORE_CODE))
      .limit(1);
    if (!store) {
      throw new ServiceUnavailableException({
        code: 'STORE_NOT_CONFIGURED',
        message: 'The Bokku store is not configured yet',
      });
    }
    req.store = store;

    if (user.role === 'PLATFORM_ADMIN') return true;

    const [membership] = await this.database.db
      .select({ id: storeStaff.id })
      .from(storeStaff)
      .where(and(eq(storeStaff.storeId, store.id), eq(storeStaff.userId, user.id)))
      .limit(1);
    if (!membership) {
      throw new ForbiddenException({
        code: 'NOT_STORE_STAFF',
        message: 'You are not assigned to this store',
      });
    }
    return true;
  }
}

/** Param decorator injecting the guard-resolved store. */
export const CurrentStore = createParamDecorator((_: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<Request & { store?: Store }>();
  return req.store;
});
