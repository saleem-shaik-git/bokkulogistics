import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { User } from '@bokku/database';
import type { Request } from 'express';

/**
 * Injects the authenticated user loaded by JwtAuthGuard
 * (or a single field, e.g. `@CurrentUser('id')`).
 */
export const CurrentUser = createParamDecorator(
  (field: keyof User | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<Request & { user?: User }>();
    const user = req.user;
    if (!user) return undefined;
    return field ? user[field] : user;
  },
);
