import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { TEST_DATABASE_URL } from './global-setup';

/**
 * Phase 12 hardening, end to end: the rate limiter opts in via env
 * (offline under NODE_ENV=test otherwise), health probes split
 * liveness/readiness, and the error envelope/request-id plumbing behave
 * for unmapped routes.
 */

const TEST_REDIS_URL = 'redis://127.0.0.1:6379/1';

/** Loosely-typed response body for property access without `any`. */
interface AnyBody {
  success?: boolean;
  requestId?: string;
  status?: string;
  services?: Record<string, string>;
  error?: { code?: string; message?: string };
}

function bodyOf(res: globalThis.Response): Promise<AnyBody> {
  return res.json() as Promise<AnyBody>;
}

let app: INestApplication;
let baseUrl: string;
let redis: Redis;

beforeAll(async () => {
  // Must be set before the config module parses process.env.
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.REDIS_URL = TEST_REDIS_URL;
  process.env.RATE_LIMIT_ENABLED = 'true';
  process.env.RATE_LIMIT_AUTH_PER_MINUTE = '3';

  app = await NestFactory.create(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0);
  const address = app.getHttpServer().address();
  if (typeof address === 'string' || !address) throw new Error('no address');
  baseUrl = `http://127.0.0.1:${address.port}/api/v1`;
  redis = new Redis(TEST_REDIS_URL);
});

afterAll(async () => {
  try {
    await app.close();
  } finally {
    redis.disconnect();
    delete process.env.RATE_LIMIT_ENABLED;
    delete process.env.RATE_LIMIT_AUTH_PER_MINUTE;
  }
});

beforeEach(async () => {
  await redis.flushdb();
});

describe('rate limiting', () => {
  it('auth endpoints enforce the strict bucket: 3 good(401) attempts then 429', async () => {
    const attempt = () =>
      fetch(`${baseUrl}/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'nobody@bokku.test', password: 'WrongPassword1!' }),
      });

    const first = await attempt();
    expect(first.status).toBe(401);
    expect(first.headers.get('x-ratelimit-limit')).toBe('3');
    expect(first.headers.get('x-ratelimit-remaining')).toBe('2');

    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);

    const limited = await attempt();
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toMatch(/^[1-9]\d*$/);
    const body = await bodyOf(limited);
    expect(body).toMatchObject({
      success: false,
      error: { code: 'RATE_LIMITED' },
    });
    expect(body.requestId).toBeDefined();
  });

  it('an exhausted auth bucket does not throttle other buckets from the same client', async () => {
    // The login attempts above exhausted rl:auth:ip:*; untagged routes use
    // rl:default:ip:* — an independent window keyed by bucket name.
    for (let i = 0; i < 3; i++) {
      const res = await fetch(`${baseUrl}/health/live`);
      expect(res.status).toBe(200);
      expect(res.headers.get('x-ratelimit-limit')).toBe('300');
    }
  });

  it('unauthenticated catalogue reads keep the generous default bucket', async () => {
    const res = await fetch(`${baseUrl}/stores`);
    expect(res.status).toBe(200);
    expect(res.headers.get('x-ratelimit-limit')).toBe('300');
  });
});

describe('health probes', () => {
  it('live is dependency-free and always 200', async () => {
    const res = await fetch(`${baseUrl}/health/live`);
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body).toEqual({ status: 'ok', services: { api: 'up' } });
  });

  it('ready probes dependencies and reports 200 when up', async () => {
    const res = await fetch(`${baseUrl}/health/ready`);
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body).toMatchObject({
      status: 'ok',
      services: { api: 'up', database: 'up', redis: 'up' },
    });
  });

  it('legacy /health stays 200 with the in-body status', async () => {
    const res = await fetch(`${baseUrl}/health`);
    expect(res.status).toBe(200);
    const body = await bodyOf(res);
    expect(body.status).toBeDefined();
    expect(body.services?.api).toBe('up');
  });
});

describe('request plumbing', () => {
  it('unknown routes return the standard 404 envelope and echo x-request-id', async () => {
    const res = await fetch(`${baseUrl}/no-such-route`, {
      headers: { 'x-request-id': 'acceptance-test-1234' },
    });
    expect(res.status).toBe(404);
    expect(res.headers.get('x-request-id')).toBe('acceptance-test-1234');
    const body = await bodyOf(res);
    expect(body).toMatchObject({
      success: false,
      requestId: 'acceptance-test-1234',
    });
    expect(body.error?.code).toBeDefined();
    expect(body.error?.message).toBeDefined();
  });

  it('bodies beyond the parser limit get an honest 413 envelope, not a 500', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'x@y.z', password: 'pad'.padEnd(200_000, 'a') }),
    });
    expect(res.status).toBe(413);
    const body = await bodyOf(res);
    expect(body).toMatchObject({
      success: false,
      error: { code: 'PAYLOAD_TOO_LARGE' },
    });
  });

  it('malformed JSON gets an honest 400 envelope, not a 500', async () => {
    const res = await fetch(`${baseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"email": "broken',
    });
    expect(res.status).toBe(400);
    const body = await bodyOf(res);
    expect(body).toMatchObject({
      success: false,
      error: { code: 'BAD_REQUEST' },
    });
  });
});
