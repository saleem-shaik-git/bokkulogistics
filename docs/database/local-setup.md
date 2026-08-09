# Local PostgreSQL & Redis setup

The app expects:

- PostgreSQL 16 at `127.0.0.1:5432`
- Redis 7 at `127.0.0.1:6379`

## Option A — Docker (recommended)

```bash
docker compose up -d postgres redis
```

This creates role `bokku`, database `bokku_dev`, password `bokku_dev_password`
(matching `.env.example`).

## Option B — native install

```sql
CREATE ROLE bokku LOGIN PASSWORD 'bokku_dev_password';
CREATE DATABASE bokku_dev OWNER bokku;
```

## Troubleshooting: `password authentication failed for user "bokku"`

1. **Server not actually running** — check with `pg_isready -h 127.0.0.1 -p 5432`.
2. **Password mismatch** — the password in `DATABASE_URL` must match the role's
   password. Recreate the role or update `.env`.
3. **Special characters not URL-encoded** — a password like `p@ss#1` must be
   percent-encoded (`p%40ss%231`) inside `DATABASE_URL`, otherwise the host
   parses incorrectly.
4. **Docker volume trap** — `POSTGRES_PASSWORD` is applied only when the data
   volume is initialized. Changing it later has no effect until you run
   `docker compose down -v` (this deletes local data) and `up` again.
5. **Wrong host** — inside containers use the service name (`postgres:5432`),
   not `localhost` (that resolves to the container itself).

## Migrations & seeds (Drizzle)

```bash
pnpm db:generate   # generate SQL migrations from packages/database/src/schema
pnpm db:migrate    # apply migrations to DATABASE_URL
pnpm db:seed       # seed development data (Phase 2+)
```

Seed data (Phase 3+) will create: 1 Bokku store, 5 categories, 20 products,
1 platform admin, 1 store manager, 1 test customer — all with obviously-fake
test credentials documented in the seed file.
