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

## Payments (Phase 6)

Trust model: **amounts come only from server-side computation; confirmation
comes only from server-side verification** (webhook → verifyPayment, or the
same verify on read). Client redirects never mark anything paid.

- `POST /payments/initialize` (auth) — `{ addressId, callbackUrl? }`. Recomputes
  the checkout preview and creates the transaction **idempotently**: same
  cart + same total ⇒ the same `bokku_pay_<32hex>` reference is returned;
  changed total ⇒ the stale PENDING row is ABANDONED (`CART_TOTAL_CHANGED`)
  and a fresh reference issued (one-pending-per-cart is enforced by a partial
  unique index, race-safe); a SUCCESS cart ⇒ `409 CART_ALREADY_PAID`.
  Response: payment summary + `authorizationUrl` (Paystack hosted page, or
  `/payment/mock?reference=…` for the mock provider).
- `GET /payments/:reference` (auth, owner only → 404 otherwise). While
  PENDING, re-verifies with the provider on read — the webhook-delay fallback.
- `POST /payments/webhook/paystack` (public, hidden from Swagger) — HMAC
  SHA-512 over the RAW body (`x-paystack-signature`, timing-safe compare);
  rejects invalid signatures `401 PAYMENT_WEBHOOK_SIGNATURE_INVALID` (audited
  `payment.webhook_rejected`), acknowledges unknown references and
  non-`charge.success` events with 200, and applies `charge.success` through
  the idempotent confirmation path (duplicates are no-ops; provider-reported
  amount ≠ our amount ⇒ FAILED + `payment.amount_mismatch` audit).
- `POST /payments/mock/complete` (public, mock provider + non-production
  only) — the web mock checkout reports success/failure through **the same
  confirmation path** a real webhook drives.
- Provider selection via `PAYMENT_PROVIDER` (default MOCK; PAYSTACK fails
  fast without `PAYSTACK_SECRET_KEY`). `refundPayment` exists on the
  interface for Phase 7 order refunds. Audits: `payment.initialized /
  succeeded / failed / amount_mismatch / webhook_rejected`.

## Orders (Phase 7)

An order is born **from a settled payment** — auto-converted right inside
the payment confirmation, or placed explicitly with `POST /orders`. Both
paths flow through the same conversion, anchored by a unique
`orders.payment_id` (one order per payment ⇒ retries converge). In one
transaction: stock is reserved (guarded conditional UPDATEs),
`BK-YYYYMMDD-XXXXXX` number generated, the order is inserted
PENDING_PAYMENT with full price/address/quote snapshots, item snapshots are
copied from the payment metadata, the order moves to PAID, and the source
cart is consumed. Any failure rolls everything back (audited
`order.conversion_failed`) — never a partial order.

- `POST /orders` (auth) — `{ paymentReference }`; idempotent. 404
  `PAYMENT_NOT_FOUND` for another user's reference, 409 `PAYMENT_NOT_SETTLED`
  while the payment is unconfirmed, 409 `INSUFFICIENT_STOCK` when an
  oversell race lost (payment stays settled for support).
- `GET /orders?page&limit` (auth) — own orders, newest first, with
  `itemCount`.
- `GET /orders/:id` (auth, owner only → 404) — full detail: item snapshots
  (immune to later catalogue edits), delivery address/quote snapshots,
  subtotal/deliveryFee/serviceFee/tax/discount/total (integer kobo),
  timestamps.
- `POST /orders/:id/cancel` (auth, owner) — only legal while
  PENDING_PAYMENT (policy); paid orders are cancelled by Bokku staff who
  run the refund path. 409 `ORDER_INVALID_TRANSITION` otherwise.

Bokku operations (staff gates as in [Catalogue](#catalogue-phase-3)):

- `GET /bokku/orders?status&page&limit` — store orders, optional status
  filter (400 on unknown statuses), paginated.
- `GET /bokku/orders/:id` — store-scoped detail (foreign ids → 404).
- `PATCH /bokku/orders/:id/status` — `{ status, reason? }`. Staff edges:
  `PAID→CONFIRMED→PREPARING→READY_FOR_PICKUP` plus cancellation from any
  pre-fulfilment state. `CANCELLED` additionally: releases reservations,
  then drives `CANCELLED→REFUND_PENDING→REFUNDED` via the payment provider
  (`payment.refunded` audit; a failed refund leaves the order REFUND_PENDING
  for ops to retry — never faked). Refund statuses can't be set directly.
  Everything else → 409 `ORDER_INVALID_TRANSITION`.

State machine (`OrderStatePolicy`, the single legal source — arbitrary
transitions are rejected): PENDING_PAYMENT→PAID→CONFIRMED→PREPARING→
READY_FOR_PICKUP→(DELIVERY_REQUESTED→DRIVER_ASSIGNED→OUT_FOR_DELIVERY→
DELIVERED, SYSTEM-only — Phase 9), CANCELLED→REFUND_PENDING→REFUNDED
(SYSTEM-only). Customers may only cancel before payment. Terminal:
DELIVERED, CANCELLED, REFUNDED.

## Operations dashboard (Phase 8)

- `GET /bokku/dashboard` (staff gates as above) — headline numbers for the
  ops workspace: `todayOrders` / `todayRevenue` (UTC calendar day; revenue
  = collected and not cancelled/refunded), `pendingFulfillment`
  (PAID→OUT_FOR_DELIVERY), `outForDelivery`, all-time `ordersByStatus`
  counts, `lowStockCount` / `outOfStockCount` and the five most severe
  `lowStockAlerts` (worst sellable first).
- The **web workspace at `/bokku`** (staff-only shell; the API enforces the
  gates regardless): Overview with the dashboard cards, the order queue
  (status tabs + one-click legal next step + cancel/refund with a required
  reason), product management (list/create/edit, Naira ⇄ kobo at the API
  boundary), and inventory (on hand/reserved/sellable with flags, audited
  set/delta adjustments). Staff sign-in routes here by default; customers
  are bounced back to the storefront.

## Deliveries (Phase 9)

Dispatch and courier tracking. `deliveries` holds one row per order
(unique `deliveries_order_unique` — the idempotency anchor), and every
customer/staff read *syncs* the provider state first, so polling the
tracking endpoint is what moves the courier along (no websockets, no
workers in the MVP).

- **Dispatch happens automatically.** Marking an order `READY_FOR_PICKUP`
  dispatches the courier through the `DeliveryProvider` and moves the
  order to `DELIVERY_REQUESTED` in the same request (audit
  `delivery.dispatched`; a provider failure logs `delivery.dispatch_failed`
  and leaves the order READY so staff can retry — the request still
  succeeds).
- `POST /bokku/orders/:id/dispatch` (staff) — explicit dispatch/retry.
  Idempotent (existing delivery returned as-is); 409
  `DELIVERY_NOT_DISPATCHABLE` unless the order is READY_FOR_PICKUP.
- `GET /orders/:id/tracking` (owner) and `GET /bokku/orders/:id/tracking`
  (store staff) — sync + return the courier state; 404 `DELIVERY_NOT_FOUND`
  until something is dispatched. Body: `externalId`, `provider`, `status`,
  `courier` (name/phone/vehicle — only once a rider is assigned),
  `etaMinutes` (from the honored quote), `dispatchedAt` / `deliveredAt` /
  `cancelledAt`. Unsets → `dispatchedAt` is always set (the row is born
  at dispatch time).
- **Status mapping.** Courier stages fast-forward the order through
  `DRIVER_ASSIGNED` → `OUT_FOR_DELIVERY` (at PICKED_UP) → `DELIVERED`.
  The final step settles the inventory reservation (on-hand −= qty,
  reserved released) and stamps `deliveredAt` atomically.
- **Cancellation window.** Staff may cancel up to `DRIVER_ASSIGNED`; the
  courier is cancelled through the provider first and a 409
  `DELIVERY_NOT_CANCELLABLE` aborts the cancellation without touching
  stock or the payment (parity with real bolt/Uber rules: no cancellation
  once the rider has the parcel). A provider-side cancellation is synced
  but never refunds or changes the order by itself.
- **Mock provider** (`DELIVERY_DEFAULT_PROVIDER=MOCK`, default): Redis
  simulation keyed `mockdel:<id>` (24 h TTL), progression
  DRIVER_ASSIGNED@10s → DRIVER_ARRIVING@30s → PICKED_UP@45s →
  IN_TRANSIT@60s → DELIVERED@120s, cancellable only in
  REQUESTED/DRIVER_ASSIGNED, interpolated courier location for live
  tracking payloads. `UBER`/`BOLT` fail loudly with
  `DELIVERY_PROVIDER_NOT_CONFIGURED` at boot until real adapters land.

## Platform admin (Phase 10)

`PLATFORM_ADMIN`-only surface (`@Roles('PLATFORM_ADMIN')` on the whole
controller; every route also requires auth as usual). Cross-store by
design — fulfillment actions stay in `/bokku`; admin reads are
oversight, and the only mutations are user role/status changes.

- `GET /admin/dashboard` — platform aggregates: orders/revenue for the
  UTC day and all time (revenue = collected, excluding cancel/refund
  states), orders by status, deliveries by courier status (`activeDeliveries`
  = non-terminal), users by role + `newUsersToday` + `suspendedUsers`,
  store totals.
- `GET /admin/users?role=&status=&q=&page&limit=` — paginated user list;
  `q` is a case-insensitive email/name search (ILIKE metacharacters
  escaped); soft-deleted accounts are excluded.
- `PATCH /admin/users/:id/role` `{ role, reason? }` — audited
  (`admin.user_role_changed`). Single-store rule: promoting to
  STORE_MANAGER/BOKKU_ADMIN creates the BOKKU `store_staff` membership;
  demoting away from staff roles removes memberships.
- `PATCH /admin/users/:id/status` `{ status: ACTIVE|SUSPENDED, reason? }` —
  audited (`admin.user_status_changed`). Suspension is effective on the
  target's **next request** because the global JWT guard re-loads the
  account status per call (no token-revocation plumbing).
- Both mutations: 404 `USER_NOT_FOUND`; 409 `ADMIN_SELF_MODIFICATION` on
  your own account; 409 `ADMIN_LAST_PLATFORM_ADMIN` when the change would
  remove the last active platform admin (defense in depth). Repeat calls
  are idempotent 200 no-ops (no duplicate audit rows).
- `GET /admin/stores` — every store with staff/product counts and today's
  order/revenue numbers.
- `GET /admin/orders?status=&storeId=&page&limit=` and
  `GET /admin/orders/:id` — cross-store order reads (404-scoped).
- `GET /admin/audit-logs?action=&actorId=&from=&to=&page&limit=` — the audit
  trail, newest first, joined with the acting user; `action` is a prefix
  filter (`order` ⇒ `order.*`).
- The **web console at `/admin`** (platform-admin shell): overview cards,
  user management (search/filters + inline role select and
  suspend/reactivate), stores, cross-store orders (rows deep-link to the
  ops detail in `/bokku`), and the audit reader with expandable metadata.
  Platform admins land here after login; the account menu links both
  consoles.

## Security defaults

Helmet headers, CORS (open in dev, origin-locked via `CORS_ORIGINS` in
production), global `ValidationPipe` (whitelist + transform), secrets never
returned in responses or logs (query parameters containing
`password|token|secret|authorization|cookie` are redacted from logs).
Rate limiting arrives with Phase 12.
