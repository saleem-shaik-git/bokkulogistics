import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

export interface DatabaseConnection {
  db: Database;
  /** Raw postgres.js client — must be ended on shutdown. */
  client: postgres.Sql;
}

/**
 * Create a pooled Drizzle connection to PostgreSQL.
 * Pool size stays small for the MVP; tune via options as load grows.
 */
export function createDatabaseConnection(
  connectionString: string,
  options: { max?: number } = {},
): DatabaseConnection {
  const client = postgres(connectionString, {
    max: options.max ?? 10,
    // Fail fast at startup instead of hanging requests.
    connect_timeout: 5,
  });
  const db = drizzle(client, { schema });
  return { db, client };
}

/** Lightweight liveness probe used by the API health endpoint. */
export async function pingDatabase(client: postgres.Sql): Promise<boolean> {
  try {
    await client`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}
