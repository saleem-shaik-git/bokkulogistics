/**
 * Development seed script.
 *
 * Phase 2 seeds test users (all with the obviously-fake password `Password123!`).
 * Later phases add the Bokku store, categories and products.
 * Safe to re-run — existing rows are skipped (ON CONFLICT DO NOTHING).
 */
import { hash } from '@node-rs/argon2';
import postgres from 'postgres';

const SEED_PASSWORD = 'Password123!';

const SEED_USERS = [
  {
    email: 'admin@bokku.test',
    role: 'PLATFORM_ADMIN',
    firstName: 'Platform',
    lastName: 'Admin',
  },
  {
    email: 'bokku-admin@bokku.test',
    role: 'BOKKU_ADMIN',
    firstName: 'Bokku',
    lastName: 'Admin',
  },
  {
    email: 'manager@bokku.test',
    role: 'STORE_MANAGER',
    firstName: 'Store',
    lastName: 'Manager',
  },
  {
    email: 'customer@bokku.test',
    role: 'CUSTOMER',
    firstName: 'Test',
    lastName: 'Customer',
  },
] as const;

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
    process.exit(1);
  }
  const sql = postgres(url, { max: 1, connect_timeout: 5 });

  const tables = await sql`SELECT to_regclass('public.users') AS users`;
  if (!tables[0]?.users) {
    console.error('Table "users" does not exist — run `pnpm db:migrate` first.');
    await sql.end();
    process.exit(1);
  }

  const passwordHash = await hash(SEED_PASSWORD, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });

  for (const user of SEED_USERS) {
    const inserted = await sql`
      INSERT INTO users (email, password_hash, first_name, last_name, role, email_verified_at)
      VALUES (${user.email}, ${passwordHash}, ${user.firstName}, ${user.lastName},
              ${user.role}, now())
      ON CONFLICT (email) DO NOTHING
      RETURNING id`;
    console.log(
      inserted.length > 0 ? `✓ seeded ${user.email} (${user.role})` : `• exists  ${user.email}`,
    );
  }

  console.log(`\nTest credentials (dev only): password for all seed users is "${SEED_PASSWORD}"`);
  await sql.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
