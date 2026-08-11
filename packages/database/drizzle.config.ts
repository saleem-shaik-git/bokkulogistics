import { defineConfig } from 'drizzle-kit';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  // drizzle-kit still needs the config file present for `generate`;
  // a missing URL only breaks migrate/push, so warn instead of throwing.
  // eslint-disable-next-line no-console
  console.warn('[drizzle] DATABASE_URL is not set — generate will work, migrate/push will fail.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './drizzle',
  dbCredentials: {
    url: databaseUrl ?? 'postgresql://localhost:5432/placeholder',
  },
  strict: true,
  verbose: true,
});
