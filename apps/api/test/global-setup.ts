import { resolve } from 'node:path';

import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';

export const TEST_DATABASE_URL = 'postgresql://bokku:bokku_dev_password@127.0.0.1:5432/bokku_test';

/**
 * Applies all Drizzle migrations to the dedicated test database once per run.
 */
export default async function globalSetup(): Promise<void> {
  const client = postgres(TEST_DATABASE_URL, { max: 1 });
  try {
    const db = drizzle(client);
    await migrate(db, {
      // Resolved from process.cwd() (apps/api) — import.meta.url is not
      // reliable inside the vitest module runner.
      migrationsFolder: resolve(process.cwd(), '../../packages/database/drizzle'),
    });
  } finally {
    await client.end();
  }
}
