import { HttpException, HttpStatus, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { EnvConfig } from '@bokku/config';
import type { Redis } from 'ioredis';
import { describe, expect, it, vi } from 'vitest';

import { RateLimitGuard } from '../src/modules/rate-limit/rate-limit.guard';
import type { RateLimitOptions } from '../src/modules/rate-limit/rate-limit.decorator';

/**
 * Fixed-window limiter behavior, isolated from Nest: a stubbed
 * ExecutionContext/Reflector, an in-memory Redis double implementing
 * just INCR/PEXPIRE, and a plain env config.
 */

interface FakeRequestish {
  ip?: string;
  user?: { id?: string };
}

function buildContext(req: FakeRequestish) {
  const headers = new Map<string, string>();
  const http = {
    getRequest: () => req,
    getResponse: () => ({
      setHeader: (name: string, value: string) => void headers.set(name.toLowerCase(), value),
    }),
  };
  const context = {
    switchToHttp: () => http,
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
  return { context, headers };
}

function fakeRedis() {
  const store = new Map<string, { count: number }>();
  return {
    store,
    incr: async (key: string) => {
      const entry = store.get(key) ?? { count: 0 };
      entry.count += 1;
      store.set(key, entry);
      return entry.count;
    },
    pexpire: async (_key: string, _ms: number) => 1,
  } as unknown as Redis & { store: Map<string, { count: number }> };
}

function buildGuard(options: {
  env?: Partial<EnvConfig>;
  routeMetadata?: RateLimitOptions;
  redis?: Redis;
}) {
  const reflector = {
    getAllAndOverride: vi.fn(() => options.routeMetadata),
  } as unknown as Reflector;
  const redis = options.redis ?? fakeRedis();
  const env = {
    NODE_ENV: 'development',
    RATE_LIMIT_DEFAULT_PER_MINUTE: 5,
    RATE_LIMIT_AUTH_PER_MINUTE: 2,
    RATE_LIMIT_SENSITIVE_PER_MINUTE: 3,
    ...options.env,
  } as EnvConfig;
  return { guard: new RateLimitGuard(reflector, redis, env), redis };
}

describe('RateLimitGuard', () => {
  it('allows up to the limit, then 429s with standard headers', async () => {
    const { guard } = buildGuard({});
    const { context, headers } = buildContext({ ip: '10.0.0.1' });

    for (let i = 0; i < 5; i++) {
      await expect(guard.canActivate(context)).resolves.toBe(true);
    }

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(HttpException);
    const error = await guard.canActivate(context).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'RATE_LIMITED' });

    expect(headers.get('x-ratelimit-limit')).toBe('5');
    expect(headers.get('x-ratelimit-remaining')).toBe('0');
    expect(headers.get('x-ratelimit-reset')).toMatch(/^\d+$/);
    expect(headers.get('retry-after')).toMatch(/^\d+$/);
  });

  it('decrements X-RateLimit-Remaining per hit', async () => {
    const { guard } = buildGuard({});
    const { context, headers } = buildContext({ ip: '10.0.0.2' });

    await guard.canActivate(context);
    expect(headers.get('x-ratelimit-remaining')).toBe('4');
    await guard.canActivate(context);
    expect(headers.get('x-ratelimit-remaining')).toBe('3');
  });

  it('limits authenticated clients per user id — NAT-shared IPs do not pool', async () => {
    const { guard } = buildGuard({});

    const aliceA = buildContext({ ip: '10.9.9.9', user: { id: 'user-a' } });
    const aliceB = buildContext({ ip: '10.8.8.8', user: { id: 'user-a' } });
    const bob = buildContext({ ip: '10.9.9.9', user: { id: 'user-b' } });

    // Same user from two "different IPs" shares one window.
    for (let i = 0; i < 5; i++) await guard.canActivate(aliceA.context);
    await expect(guard.canActivate(aliceB.context)).rejects.toBeInstanceOf(HttpException);
    // A different user on the overloaded IP still has a full window.
    for (let i = 0; i < 5; i++) await expect(guard.canActivate(bob.context)).resolves.toBe(true);
  });

  it('exhausting the auth bucket does not affect untagged routes on the same IP', async () => {
    const { guard, redis } = buildGuard({ routeMetadata: { bucket: 'auth' } });
    const { context } = buildContext({ ip: '10.0.0.4' });
    await guard.canActivate(context);
    await guard.canActivate(context);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(HttpException);

    const untagged = buildGuard({ redis });
    const { context: plain } = buildContext({ ip: '10.0.0.4' });
    await expect(untagged.guard.canActivate(plain)).resolves.toBe(true);
  });

  it('fails open when Redis is down so the limiter never blocks the app', async () => {
    const downRedis = {
      incr: async () => {
        throw new Error('ECONNREFUSED');
      },
      pexpire: async () => 1,
    } as unknown as Redis;
    const { guard } = buildGuard({ redis: downRedis });
    const { context } = buildContext({ ip: '10.0.0.5' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('is disabled by default under NODE_ENV=test', async () => {
    const { guard } = buildGuard({ env: { NODE_ENV: 'test' } });
    const { context, headers } = buildContext({ ip: '10.0.0.6' });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(headers.has('x-ratelimit-limit')).toBe(false);
  });

  it('NODE_ENV=test + explicit RATE_LIMIT_ENABLED=true opts in', async () => {
    const { guard } = buildGuard({
      env: { NODE_ENV: 'test', RATE_LIMIT_ENABLED: true },
    });
    const { context } = buildContext({ ip: '10.0.0.7' });

    for (let i = 0; i < 5; i++) await guard.canActivate(context);
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(HttpException);
  });
});
