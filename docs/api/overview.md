# API conventions

## Versioning & docs

- Every route is prefixed with `/api/v1`.
- Interactive docs (Swagger UI): `http://localhost:4000/api/docs`.

## Response envelopes

Success:

```json
{ "success": true, "data": {} }
```

Failure:

```json
{
  "success": false,
  "error": { "code": "ORDER_NOT_FOUND", "message": "Order was not found" },
  "requestId": "4d0d..."
}
```

Every request gets an `x-request-id` response header; incoming `x-request-id`
headers are honored for proxy correlation. The `requestId` also appears in
structured request logs (method, path, status, response time, userId when
authenticated).

## Pagination

List endpoints accept `?page=1&limit=20` (max limit 100) and return:

```json
{
  "success": true,
  "data": {
    "data": [ ... ],
    "meta": { "page": 1, "limit": 20, "total": 100, "totalPages": 5 }
  }
}
```

## Health

`GET /api/v1/health` →

```json
{ "status": "ok", "services": { "api": "up", "database": "up", "redis": "up" } }
```

Probes time out after 2s and degrade individually (`status` becomes `error`).

## Authentication (Phase 2)

- `POST /auth/register` · `POST /auth/login` → `{ user, tokens }` (passwords hashed
  with Argon2id; role is always assigned server-side).
- Access token: JWT, 15 min (`Authorization: Bearer …`).
- Refresh token: JWT, 30 days, **rotating** — the presented token is revoked on
  every use; reusing a revoked token revokes the whole session chain (theft
  detection). Only SHA-256 hashes are stored server-side.
- `POST /auth/forgot-password` is enumeration-safe; `/auth/reset-password`
  consumes the token once and revokes all sessions; `/auth/verify-email`
  consumes verification tokens once.
- Authorization: global `JwtAuthGuard` (skips `@Public()` routes) + global
  `RolesGuard` (`@Roles(...)`), with `req.user` always loaded fresh from the
  database so suspended accounts lose access immediately.
- Audit: `auth.register`, `auth.login.success/failure`, `auth.logout`,
  `auth.refresh.reuse_detected`, `auth.password_reset.*`, `auth.email_verified`
  are written to `audit_logs`.

## Security defaults

Helmet headers, CORS (open in dev, origin-locked via `CORS_ORIGINS` in
production), global `ValidationPipe` (whitelist + transform), secrets never
returned in responses or logs (query parameters containing
`password|token|secret|authorization|cookie` are redacted from logs).
Rate limiting arrives with Phase 12.
