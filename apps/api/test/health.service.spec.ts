import { describe, expect, it, vi } from 'vitest';
import type { DatabaseConnection } from '@bokku/database';
import type { Redis } from 'ioredis';

import { HealthService } from '../src/modules/health/health.service';

function makeDatabase(healthy: boolean): DatabaseConnection {
  const sqlTag = (() => {
    if (healthy) return Promise.resolve([{ '?column?': 1 }]);
    return Promise.reject(new Error('connection refused'));
  }) as unknown as DatabaseConnection['client'];
  return { db: {} as DatabaseConnection['db'], client: sqlTag };
}

function makeRedis(healthy: boolean): Redis {
  return {
    status: 'ready',
    connect: vi.fn().mockResolvedValue(undefined),
    ping: healthy
      ? vi.fn().mockResolvedValue('PONG')
      : vi.fn().mockRejectedValue(new Error('redis unreachable')),
  } as unknown as Redis;
}

describe('HealthService', () => {
  it('reports ok when database and redis respond', async () => {
    const service = new HealthService(makeDatabase(true), makeRedis(true));
    const result = await service.check();

    expect(result).toEqual({
      status: 'ok',
      services: { api: 'up', database: 'up', redis: 'up' },
    });
  });

  it('degrades when the database probe fails', async () => {
    const service = new HealthService(makeDatabase(false), makeRedis(true));
    const result = await service.check();

    expect(result.status).toBe('error');
    expect(result.services.database).toBe('down');
    expect(result.services.redis).toBe('up');
  });

  it('degrades when redis fails to ping', async () => {
    const service = new HealthService(makeDatabase(true), makeRedis(false));
    const result = await service.check();

    expect(result.status).toBe('error');
    expect(result.services.database).toBe('up');
    expect(result.services.redis).toBe('down');
  });

  it('never throws even if both probes fail', async () => {
    const service = new HealthService(makeDatabase(false), makeRedis(false));
    await expect(service.check()).resolves.toMatchObject({ status: 'error' });
  });
});
