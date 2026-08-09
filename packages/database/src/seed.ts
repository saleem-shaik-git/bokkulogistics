/**
 * Development seed script.
 *
 * Phase 1 verifies database connectivity only. Real seed data
 * (Bokku store, categories, products, test users) arrives with the
 * feature phases that introduce those tables.
 */
import postgres from 'postgres';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is not set. Copy .env.example to .env first.');
    process.exit(1);
  }
  const sql = postgres(url, { max: 1, connect_timeout: 5 });
  const rows = await sql`SELECT current_database() AS db, current_user AS usr, version() AS ver`;
  console.log('✓ Connected to PostgreSQL');
  console.log(`  database: ${rows[0]?.db}`);
  console.log(`  user:     ${rows[0]?.usr}`);
  console.log('ℹ No tables exist yet — seed data ships with Phase 2+.');
  await sql.end();
}

main().catch((err) => {
  console.error('Seed/connectivity check failed:', err);
  process.exit(1);
});
