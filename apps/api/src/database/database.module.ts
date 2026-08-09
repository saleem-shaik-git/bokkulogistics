import { Global, Inject, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { createDatabaseConnection, type DatabaseConnection } from '@bokku/database';
import type { EnvConfig } from '@bokku/config';
import { Redis } from 'ioredis';

import { DRIZZLE_CLIENT, ENV_CONFIG, REDIS_CLIENT } from '../config/constants';

/**
 * Infrastructure connections shared by all feature modules:
 *  - DRIZZLE_CLIENT: pooled Drizzle ORM connection (PostgreSQL)
 *  - REDIS_CLIENT: ioredis connection (cache/queues later)
 */
@Global()
@Module({
  providers: [
    {
      provide: DRIZZLE_CLIENT,
      inject: [ENV_CONFIG],
      useFactory: (env: EnvConfig): DatabaseConnection =>
        createDatabaseConnection(env.DATABASE_URL),
    },
    {
      provide: REDIS_CLIENT,
      inject: [ENV_CONFIG],
      useFactory: (env: EnvConfig): Redis =>
        new Redis(env.REDIS_URL, {
          lazyConnect: true,
          maxRetriesPerRequest: 1,
          retryStrategy: (times) => (times > 3 ? null : Math.min(times * 200, 1000)),
        }),
    },
  ],
  exports: [DRIZZLE_CLIENT, REDIS_CLIENT],
})
export class DatabaseModule implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(
    @Inject(DRIZZLE_CLIENT) private readonly database: DatabaseConnection,
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  async onModuleDestroy(): Promise<void> {
    try {
      this.redis.disconnect();
      await this.database.client.end({ timeout: 5 });
    } catch (error) {
      this.logger.warn('Error while closing infrastructure connections', error as Error);
    }
  }
}
