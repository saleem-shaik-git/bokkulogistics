import { z } from 'zod';

/**
 * Single source of truth for environment variables.
 * Secrets are never shipped to the frontend — server-only values stay here.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    APP_NAME: z.string().default('Bokku Logistics'),
    APP_URL: z.string().url().default('http://localhost:3000'),
    API_URL: z.string().url().default('http://localhost:4000'),
    PORT: z.coerce.number().int().positive().default(4000),

    DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

    JWT_SECRET: z.string().default('dev-only-jwt-secret-change-me'),
    JWT_REFRESH_SECRET: z.string().default('dev-only-jwt-refresh-secret-change-me'),

    PAYSTACK_PUBLIC_KEY: z.string().optional(),
    PAYSTACK_SECRET_KEY: z.string().optional(),

    GOOGLE_MAPS_API_KEY: z.string().optional(),

    DELIVERY_DEFAULT_PROVIDER: z.enum(['MOCK', 'UBER', 'BOLT']).default('MOCK'),
    UBER_CLIENT_ID: z.string().optional(),
    UBER_CLIENT_SECRET: z.string().optional(),
    UBER_API_URL: z.string().optional(),
    BOLT_CLIENT_ID: z.string().optional(),
    BOLT_CLIENT_SECRET: z.string().optional(),
    BOLT_API_URL: z.string().optional(),

    SMTP_HOST: z.string().optional(),
    SMTP_PORT: z.coerce.number().int().positive().optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),

    SENTRY_DSN: z.string().optional(),
  })
  // Keep unrelated process variables accessible to the runtime.
  .passthrough();

export type EnvConfig = z.infer<typeof envSchema>;

export class EnvValidationError extends Error {
  constructor(issues: string[]) {
    super(`Invalid environment configuration:\n${issues.map((i) => `  - ${i}`).join('\n')}`);
    this.name = 'EnvValidationError';
  }
}

/**
 * Parse and validate environment variables. Fails fast with a readable
 * error listing every invalid variable.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): EnvConfig {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new EnvValidationError(issues);
  }
  return result.data;
}
