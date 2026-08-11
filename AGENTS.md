# AGENTS.md — Working agreement for coding agents

## Project

Bokku Logistics: commerce + delivery orchestration MVP. Modular monolith —
business modules in `apps/api/src/modules`, integrations isolated in
`apps/api/src/integrations` (added in later phases).

## Golden rules

1. **Work incrementally by phase.** The phase plan lives in
   `docs/architecture/overview.md`. Do not build business features ahead of
   their phase; Phase 1 is foundation only.
2. **Never commit secrets or `.env`.** Use `.env.example` placeholders.
3. **Server-side authority.** Prices, fees, totals, payment confirmation and
   order status transitions are computed/validated on the server only.
4. **Provider isolation.** Orders never call Uber/Bolt directly — always via
   the `DeliveryProvider` interface + `DeliveryProviderFactory`. Same for
   payments via `PaymentProvider`.
5. **Idempotency** for payments, webhooks, order and delivery creation.
6. **Inventory can never go negative** — order creation runs in a transaction
   with row locks.
7. Small, typed modules. No `any` (ESLint enforces it), no magic strings for
   DI tokens (`src/config/constants.ts`).

## Commands

```bash
pnpm install        # bootstrap workspace
pnpm dev            # api (4000) + web (3000) in watch mode
pnpm build          # build all
pnpm lint           # eslint
pnpm typecheck      # tsc --noEmit
pnpm test           # vitest
pnpm db:generate    # drizzle-kit generate
pnpm db:migrate     # drizzle-kit migrate
pnpm db:seed        # seed dev data
```

## Conventions

- API prefix: `/api/v1`; Swagger at `/api/docs`.
- Success envelope `{ success: true, data }`; error envelope
  `{ success: false, error: { code, message }, requestId }`.
- Pagination: `?page=1&limit=20` (max 100) → `{ data, meta }`.
- Health: `GET /api/v1/health` → `{ status, services: { api, database, redis } }`.
- Commit format: `feat:` / `fix:` / `refactor:` / `test:` / `docs:` / `chore:` — one
  logical change per commit.

## Definition of done (per phase)

`pnpm install`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm test` all pass;
dev servers start; health endpoint returns `ok`; README/docs updated.
