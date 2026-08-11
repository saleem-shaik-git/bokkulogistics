import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { EnvConfig } from '@bokku/config';
import type { Redis } from 'ioredis';
import type { Request, Response } from 'express';

import { ENV_CONFIG, REDIS_CLIENT } from '../../config/constants';
import {
  RATE_LIMIT_KEY,
  type RateLimitBucket,
  type RateLimitOptions,
} from './rate-limit.decorator';

interface WindowSpec {
  bucket: RateLimitBucket;
  limit: number;
  windowSeconds: number;
}

interface UserOnRequest {
  id?: string;
}

/**
 * Fixed-window rate limiting backed by Redis `INCR` + `PEXPIRE`.
 *
 * Identity: the authenticated user id when the JWT guard already
 * populated it (per-user limits — fair for staff/customers sharing NAT
 * egress), otherwise the client IP (pre-auth endpoints, behind the
 * platform proxy thanks to `trust proxy` in main.ts).
 *
 * Fail-open on Redis faults — a rate-limiter outage must never take the
 * storefront down with it; the failure is logged once per request.
 *
 * Disabled under NODE_ENV=test unless RATE_LIMIT_ENABLED=true is set
 * explicitly, so integration specs stay deterministic (a dedicated spec
 * opts in and proves the behavior end-to-end).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    @Inject(ENV_CONFIG) private readonly env: EnvConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const enabled = this.env.RATE_LIMIT_ENABLED ?? this.env.NODE_ENV !== 'test';
    if (!enabled) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: UserOnRequest }>();
    const res = context.switchToHttp().getResponse<Response>();
    const routeOptions = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const spec = this.resolveSpec(routeOptions);

    const identity = req.user?.id ? `user:${req.user.id}` : `ip:${req.ip ?? 'unknown'}`;
    const nowMs = Date.now();
    const windowMs = spec.windowSeconds * 1000;
    const windowId = Math.floor(nowMs / windowMs);
    const key = `rl:${spec.bucket}:${identity}:${windowId}`;

    let count: number;
    try {
      count = await this.redis.incr(key);
      if (count === 1) {
        // Set the window TTL exactly once per window.
        await this.redis.pexpire(key, windowMs);
      }
    } catch (error) {
      this.logger.warn(`Rate limiter unavailable; allowing request (${(error as Error).message})`);
      return true;
    }

    const windowEndSeconds = Math.ceil(((windowId + 1) * windowMs) / 1000);
    const remaining = Math.max(0, spec.limit - count);
    res.setHeader('X-RateLimit-Limit', String(spec.limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(windowEndSeconds));

    if (count > spec.limit) {
      const retryAfterSeconds = Math.max(1, Math.ceil(((windowId + 1) * windowMs - nowMs) / 1000));
      res.setHeader('Retry-After', String(retryAfterSeconds));
      // No TooManyRequestsException class in @nestjs/common@11 — HttpException
      // with the 429 status; the global filter emits the standard envelope.
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          message: `Too many requests — slow down and retry after ${retryAfterSeconds}s`,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }

  private resolveSpec(routeOptions: RateLimitOptions | undefined): WindowSpec {
    const bucket = routeOptions?.bucket ?? 'default';
    return {
      bucket,
      limit: routeOptions?.limit ?? this.defaultLimitFor(bucket),
      windowSeconds: routeOptions?.windowSeconds ?? 60,
    };
  }

  private defaultLimitFor(bucket: RateLimitBucket): number {
    switch (bucket) {
      case 'auth':
        return this.env.RATE_LIMIT_AUTH_PER_MINUTE;
      case 'sensitive':
        return this.env.RATE_LIMIT_SENSITIVE_PER_MINUTE;
      default:
        return this.env.RATE_LIMIT_DEFAULT_PER_MINUTE;
    }
  }
}
