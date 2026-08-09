# Bokku Logistics

Independent commerce & delivery orchestration platform. Customers shop from
**Bokku**, choose a delivery provider (Uber / Bolt / mock), pay via Paystack,
and track the order from *pending payment* to *delivered*.

> Status: **Phase 3 — Catalogue** complete. Business features land per the
> phased plan in [`docs/architecture/overview.md`](docs/architecture/overview.md).

> Conventions worth knowing:
> - **Money is always integer kobo** (`price`, all fees) — never floats. ₦1 = 100 kobo.
> - Stock authority is the `inventory` table (unique per store+product);
>   sellable = `quantity_on_hand − reserved_quantity` and can never go negative
>   (row locks + CHECK constraints).
> - Bokku ops (`/api/v1/bokku/*`) requires role **and** a `store_staff`
>   membership row — URL ids can't cross stores (rule 9).

## Stack

| Layer      | Technology                                             |
| ---------- | ------------------------------------------------------ |
| Frontend   | Next.js (App Router) · TypeScript · Tailwind · TanStack Query · Zustand |
| Backend    | NestJS · REST (`/api/v1`) · Swagger (`/api/docs`)      |
| Database   | PostgreSQL 16 · Drizzle ORM (`packages/database`)      |
| Cache/Queue| Redis 7 · BullMQ (workers arrive in later phases)      |
| Payments   | Paystack behind a `PaymentProvider` abstraction        |
| Delivery   | Provider-adapter system (`UberDeliveryProvider`, `BoltDeliveryProvider`, `MockDeliveryProvider`) |
| Tooling    | pnpm workspaces · Turborepo · Vitest · ESLint · Prettier |
| Infra      | Docker · Docker Compose · GitHub Actions               |

## Repository layout

```
apps/
  web/            # Next.js customer storefront (+ Bokku & admin areas later)
  api/            # NestJS modular monolith API
packages/
  database/       # Drizzle schema, migrations, seeds
  shared/         # Shared types/constants (API envelopes, roles, statuses)
  config/         # Zod-validated environment configuration
infrastructure/   # Dockerfiles, nginx
docs/             # architecture / api / database / deployment
tests/            # E2E test suites (Playwright, later phases)
```

## Prerequisites

- Node.js ≥ 20 and pnpm 9 (`corepack enable`)
- PostgreSQL 16 and Redis 7 running locally — **or** Docker for `docker compose up`

## Quick start

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env          # local dev defaults work out of the box

# 3. Start PostgreSQL + Redis
docker compose up -d postgres redis
#    (or any local PostgreSQL 16 / Redis 7 — point DATABASE_URL / REDIS_URL at them)

# 4. Run web + api in watch mode
pnpm dev
```

| URL                              | What                       |
| -------------------------------- | -------------------------- |
| http://localhost:3000            | Customer storefront        |
| http://localhost:4000/api/v1/health | API health (db + redis probes) |
| http://localhost:4000/api/docs   | Swagger UI                 |

### Seeded test credentials

`pnpm db:seed` creates dev-only accounts (password for all: `Password123!`):

| Email | Role |
| ----- | ---- |
| `admin@bokku.test` | PLATFORM_ADMIN |
| `bokku-admin@bokku.test` | BOKKU_ADMIN |
| `manager@bokku.test` | STORE_MANAGER |
| `customer@bokku.test` | CUSTOMER |

Authentication endpoints live under `/api/v1/auth/*` (register, login, refresh
with rotation + reuse detection, logout, forgot/reset password, verify-email,
me). Outside production, verification/reset tokens are returned in the response
under `data.debug.*` until the notifications module ships (Phase 11) — this is
deliberate so flows stay testable without SMTP.

### Verifying the database connection

The dev database uses role/db `bokku` with the local-only password from
`.env.example`. A wrong password yields Postgres' standard error:

```
FATAL: password authentication failed for user "bokku"
```

Fixes: recreate the role per [`docs/database/local-setup.md`](docs/database/local-setup.md),
match `DATABASE_URL` to the real password, and URL-encode special characters
(`@`, `#`, `%`, `&`) in passwords. With Docker, note that `POSTGRES_PASSWORD`
only applies when the `postgres-data` volume is first created — remove the
volume if you changed it later (`docker compose down -v`).

## Commands

| Command           | Description                                   |
| ----------------- | --------------------------------------------- |
| `pnpm install`    | Install all workspace dependencies            |
| `pnpm dev`        | Run api + web in watch mode (Turborepo)       |
| `pnpm build`      | Build every package and app                   |
| `pnpm lint`       | ESLint across the monorepo                    |
| `pnpm typecheck`  | TypeScript `--noEmit` across the monorepo     |
| `pnpm test`       | Unit tests (Vitest)                           |
| `pnpm test:e2e`   | End-to-end tests (Playwright, later phases)   |
| `pnpm db:generate`| Generate Drizzle migrations from schema       |
| `pnpm db:migrate` | Apply Drizzle migrations                      |
| `pnpm db:seed`    | Seed development data                         |

## Environment variables

See [`.env.example`](.env.example). Secrets (JWT secrets, Paystack keys,
provider credentials, DB/Redis URLs) are **server-only** — nothing is exposed
to the browser; the web app talks to the API through same-origin route handlers.

## Docker

```bash
docker compose up            # postgres + redis + api + web
docker compose --profile proxy up   # additionally nginx as single entrypoint
```

## Documentation

- [`docs/architecture/overview.md`](docs/architecture/overview.md) — modular monolith, provider adapters, phases
- [`docs/database/local-setup.md`](docs/database/local-setup.md) — PostgreSQL/Redis setup & troubleshooting
- [`docs/api/overview.md`](docs/api/overview.md) — API conventions (versioning, envelopes, errors)
- [`docs/deployment/local.md`](docs/deployment/local.md) — running everything locally / in Docker
- [`AGENTS.md`](AGENTS.md) — working agreement for coding agents

## License

Proprietary — internal Bokku project.
