import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';

import { RateLimitGuard } from './rate-limit.guard';

/**
 * Redis-backed fixed-window rate limiting (Phase 12). Registered as a
 * global guard AFTER authentication/authorization so per-user identity
 * applies; bucket limits come from the environment.
 */
@Module({
  providers: [{ provide: APP_GUARD, useClass: RateLimitGuard }],
})
export class RateLimitModule {}
