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

## Catalogue (Phase 3)

Public, no auth:
- `GET /stores`, `GET /stores/:id`, `GET /stores/:storeId/categories`
- `GET /stores/:storeId/products?page&limit&q&category` — `q` searches
  name/description (ILIKE, wildcard-escaped); `category` accepts slug or UUID.
- `GET /products/:id` — detail incl. images, SKU, sellable stock, availability.

Bokku operations (`Authorization: Bearer …` + STORE_MANAGER/BOKKU_ADMIN/PLATFORM_ADMIN
+ store_staff membership):
- `GET|POST /bokku/products`, `PATCH /bokku/products/:id`
  (slug/SKU auto-generated; creation + price/status changes audited).
- `GET /bokku/inventory` — stock + low-stock flags.
- `PATCH /bokku/inventory/:productId` — `{ adjustment | setQuantity, lowStockThreshold?, reason }`;
  row-locked, never negative (`409 INSUFFICIENT_STOCK`), every change audited with reason.

Prices are integer **kobo**; product list/detail include `stockQuantity`
(on hand − reserved) and `available` (ACTIVE ∧ stock > 0).

## Cart (Phase 4)

Authenticated (any role; JWT required):

- `GET /cart` — the current cart with **live** prices/stock re-joined from
  the products/inventory tables on every read (no price snapshots here).
  Returns `{ id: null, items: [], itemCount: 0, subtotal: 0 }` when the user
  has never added anything.
- `POST /cart/items` — `{ productId, quantity }` only; smuggled fields (e.g.
  `price`) are rejected with 400. Merges into the existing line atomically
  (unique `(cart_id, product_id)` upsert); creates the cart lazily on first
  add. Errors: `404 PRODUCT_NOT_FOUND`, `409 PRODUCT_UNAVAILABLE`
  (not ACTIVE), `409 OUT_OF_STOCK`, `409 INSUFFICIENT_STOCK` (message
  includes the remaining count), `409 CART_STORE_CONFLICT` (see rules below).
- `PATCH /cart/items/:itemId` — set exact quantity (1–99), stock re-validated.
- `DELETE /cart/items/:itemId` — remove one line.
- `DELETE /cart` — empty the cart; idempotent.

Rules: one cart per user (unique index), **single-store carts** —
adding a product from another store → `409 CART_STORE_CONFLICT`
until the cart is cleared. Lines are owner-scoped: touching another user's
line → `404 CART_ITEM_NOT_FOUND` (no IDOR). Quantities are validated against
sellable stock (on hand − reserved); the line's `available` flag flips false
when stock later drops below the cart quantity. Stock is *not* reserved at
cart time — that happens at checkout (Phase 7).

## Addresses (Phase 5)

Authenticated, owner-scoped (`404 ADDRESS_NOT_FOUND` for other users' ids):

- `GET /addresses` — default first; `POST /addresses` (first address becomes
  default automatically; max 10/user → `409 ADDRESS_LIMIT_REACHED`;
  latitude/longitude optional but must come as a pair →
  `400 COORDINATE_PAIR_REQUIRED`); `PATCH /addresses/:id`
  (`isDefault:true` demotes the previous default atomically — single default
  is also enforced by a partial unique index); `DELETE /addresses/:id`
  (deleting the default promotes the most recent remaining one).

## Checkout (Phase 5)

- `POST /checkout/preview` — `{ addressId }` → the **server-computed** order
  breakdown. Validates: cart non-empty (`400 CART_EMPTY`), every line still
  fulfillable (`409 CART_ITEMS_UNAVAILABLE`), address owned by the caller.
  Response: lines at live DB prices, delivery quote from the configured
  **DeliveryProvider** (`DELIVERY_DEFAULT_PROVIDER`, default MOCK:
  ₦500 + ₦150/started-km, haversine store→address, 5 km fallback when
  coordinates are missing, 15-min quote validity), then the pricing policy
  (constants in `@bokku/shared`: `serviceFee = 5% of subtotal`,
  `VAT = 7.5% of subtotal`, integer kobo, half-up rounding;
  `total = subtotal + deliveryFee + serviceFee + tax − discount ≥ 0`).
  Read-only and idempotent — safe to re-call before paying.
- Dispatch lifecycle (`createDelivery/status/cancel/tracking`) is defined on
  the DeliveryProvider interface but activates with orders in Phase 9; the
  mock rejects those calls with `DELIVERY_DISPATCH_NOT_IMPLEMENTED` until
  then, and UBER/BOLT fail fast `DELIVERY_PROVIDER_NOT_CONFIGURED`.

## Security defaults

Helmet headers, CORS (open in dev, origin-locked via `CORS_ORIGINS` in
production), global `ValidationPipe` (whitelist + transform), secrets never
returned in responses or logs (query parameters containing
`password|token|secret|authorization|cookie` are redacted from logs).
Rate limiting arrives with Phase 12.
