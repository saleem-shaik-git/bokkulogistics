import { Inject, Injectable } from '@nestjs/common';
import { pingDatabase, type DatabaseConnection } from '@bokku/database';
import type { HealthCheckResult } from '@bokku/shared';
import type { Redis } from 'ioredis';

import { DRIZZLE_CLIENT, REDIS_CLIENT } from '../../config/constants';

const PROBE_TIMEOUT_MS = 2_000;

@Injectable()
export class HealthService {
  constructor(
    @Inject(DRIZZLE_CLIENT) private readonly database: DatabaseConnection,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /** Full check (legacy /health): probes dependencies, reports in-body. */
  async check(): Promise<HealthCheckResult> {
    return this.readiness();
  }

  /**
   * Liveness: the process itself is up. Touches no dependencies, so a
   * Postgres/Redis outage never gets the container killed by a probe.
   */
  liveness(): HealthCheckResult {
    return {
      status: 'ok',
      services: { api: 'up' },
    };
  }

  /**
   * Readiness: probes PostgreSQL + Redis (bounded by PROBE_TIMEOUT_MS).
   * The controller maps a degraded result to HTTP 503 so load balancers
   * drain the instance without tearing it down.
   */
  async readiness(): Promise<HealthCheckResult> {
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);

    return {
      status: database && redis ? 'ok' : 'error',
      services: {
        api: 'up',
        database: database ? 'up' : 'down',
        redis: redis ? 'up' : 'down',
      },
    };
  }

  private async checkDatabase(): Promise<boolean> {
    return this.withTimeout(pingDatabase(this.database.client));
  }

  private async checkRedis(): Promise<boolean> {
    return this.withTimeout(
      (async () => {
        if (this.redis.status === 'wait') {
          await this.redis.connect();
        }
        return (await this.redis.ping()) === 'PONG';
      })(),
    );
  }

  private async withTimeout(probe: Promise<boolean>): Promise<boolean> {
    try {
      return await Promise.race([
        probe,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('health probe timed out')), PROBE_TIMEOUT_MS),
        ),
      ]);
    } catch {
      return false;
    }
  }
}
