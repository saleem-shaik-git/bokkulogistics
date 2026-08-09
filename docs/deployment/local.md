# Running locally

## Native dev loop

```bash
pnpm install
cp .env.example .env
docker compose up -d postgres redis   # or native services
pnpm dev                              # api :4000, web :3000
```

Verify:

```bash
curl http://localhost:4000/api/v1/health
# {"status":"ok","services":{"api":"up","database":"up","redis":"up"}}
```

## Everything in Docker

```bash
docker compose up --build
```

- api → http://localhost:4000 (`/api/docs` for Swagger)
- web → http://localhost:3000
- optional single entrypoint: `docker compose --profile proxy up` → http://localhost

Container-to-container URLs: `postgres:5432`, `redis:6379`, `api:4000` — never
`localhost` between containers.

## Sandbox / hosted preview note

When the runtime provides no Docker daemon, PostgreSQL and Redis can be run as
plain processes (see `docs/database/local-setup.md`); the API and web apps run
with `pnpm dev` bound to `0.0.0.0`, and the web app reaches the API through
the server-side proxy route `apps/web/src/app/api/health/route.ts`
(`API_INTERNAL_URL`) so the browser never calls internal hosts directly.
