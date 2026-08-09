import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { eq } from 'drizzle-orm';
import type { Request } from 'express';
import { Inject } from '@nestjs/common';
import { users, type DatabaseConnection, type User } from '@bokku/database';

import { DRIZZLE_CLIENT } from '../../config/constants';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { TokenService } from '../../modules/auth/token.service';

/**
 * Global authentication guard.
 * - Skips routes marked @Public().
 * - Verifies the Bearer access token, then loads the user fresh from the
 *   database so suspended/deleted accounts lose access immediately.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    @Inject(DRIZZLE_CLIENT) private readonly database: DatabaseConnection,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: User }>();
    const token = this.extractBearer(req);
    if (!token) {
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_MISSING',
        message: 'Authentication is required for this endpoint',
      });
    }

    let payload: { sub: string };
    try {
      payload = await this.tokens.verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_INVALID',
        message: 'Your session has expired, please log in again',
      });
    }

    const [user] = await this.database.db
      .select()
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1);

    if (!user || user.deletedAt) {
      throw new UnauthorizedException({
        code: 'AUTH_ACCOUNT_NOT_FOUND',
        message: 'This account no longer exists',
      });
    }
    if (user.status !== 'ACTIVE') {
      throw new ForbiddenException({
        code: 'AUTH_ACCOUNT_INACTIVE',
        message: `This account is ${user.status.toLowerCase()}`,
      });
    }

    req.user = user;
    return true;
  }

  private extractBearer(req: Request): string | null {
    const header = req.headers.authorization;
    if (!header) return null;
    const [scheme, token] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
    return token;
  }
}
