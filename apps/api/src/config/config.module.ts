import { Global, Module } from '@nestjs/common';
import { config as loadDotenv } from 'dotenv';
import { parseEnv, type EnvConfig } from '@bokku/config';

import { ENV_CONFIG } from './constants';

// Load .env files before validation. Repo-root .env first (shared defaults),
// then app-local .env (per-app overrides). Existing host env always wins.
loadDotenv({ path: '../../.env', override: false });
loadDotenv({ path: '.env', override: false });

/**
 * Centralized, validated environment configuration.
 * The API refuses to boot with an invalid configuration instead of
 * failing later at an arbitrary call site.
 */
@Global()
@Module({
  providers: [
    {
      provide: ENV_CONFIG,
      useFactory: (): EnvConfig => parseEnv(),
    },
  ],
  exports: [ENV_CONFIG],
})
export class AppConfigModule {}
