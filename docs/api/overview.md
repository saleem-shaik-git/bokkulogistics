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

## Security defaults (Phase 1)

Helmet headers, CORS (open in dev, origin-locked via `CORS_ORIGINS` in
production), global `ValidationPipe` (whitelist + transform), secrets never
returned in responses or logs (query parameters containing
`password|token|secret|authorization|cookie` are redacted from logs).
Rate limiting, RBAC guards and audit logging arrive with Phases 2/12.
