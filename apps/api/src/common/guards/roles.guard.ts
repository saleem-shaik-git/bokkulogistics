import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { User } from '@bokku/database';
import type { UserRole } from '@bokku/shared';
import type { Request } from 'express';

import { ROLES_KEY } from '../decorators/roles.decorator';

/**
 * Role-based authorization. Runs after JwtAuthGuard (registration order)
 * so `req.user` is always populated for protected routes.
 * Routes without @Roles() only require authentication.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: User }>();
    const user = req.user;
    // Unauthenticated request on a non-public route — JwtAuthGuard handles the
    // 401; if we somehow got here first, deny.
    if (!user) {
      throw new ForbiddenException({
        code: 'AUTH_ACCESS_DENIED',
        message: 'You do not have permission to access this resource',
      });
    }
    if (!required.includes(user.role)) {
      throw new ForbiddenException({
        code: 'AUTH_ACCESS_DENIED',
        message: 'You do not have permission to access this resource',
      });
    }
    return true;
  }
}
