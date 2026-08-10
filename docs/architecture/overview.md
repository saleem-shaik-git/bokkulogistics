# Architecture overview

## Style: modular monolith

One deployable API (`apps/api`) organized around business modules:

`auth, users, customers, stores, categories, products, inventory, cart,
addresses, orders, payments, deliveries, notifications, analytics, audit, admin`

Modules communicate through injected services/interfaces, never through
cross-module database writes — this keeps a future microservices extraction
possible without rewrites.

## External integrations are adapters

```
modules/orders ──┐
modules/deliveries ─┼──► integrations/delivery/delivery.interface.ts (DeliveryProvider)
modules/payments ──┘         ▲
                             │ DeliveryProviderFactory
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
 MockDeliveryProvider  UberDeliveryProvider  BoltDeliveryProvider
```

- **Delivery**: `getQuote / createDelivery / getDeliveryStatus / cancelDelivery / getTracking`.
  `MOCK` keeps the whole app functional without credentials (default in dev).
- **Payments**: `initializePayment / verifyPayment / refundPayment` with
  `PaystackProvider` and `MockPaymentProvider`. Payment confirmation is only
  trusted from server-side verification/webhooks.
- **Maps**: `MapsService` — geocoding/distance behind an interface; no Google
  calls in business modules.

## Key invariants

- Prices/totals are always read from PostgreSQL, never from the browser.
- Order status changes go through an explicit **OrderStatePolicy** transition
  table — arbitrary transitions are rejected.
- Inventory is decremented inside a DB transaction with row locks; failure ⇒
  rollback; stock can never go negative.
- Payment/delivery webhooks are idempotent (unique constraints + reference keys).

## Phase plan (status)

| # | Phase | Status |
| - | ----- | ------ |
| 1 | Foundation (this scaffold) | ✅ complete |
| 2 | Authentication & RBAC | ✅ complete |
| 3 | Catalogue | ✅ complete |
| 4 | Cart | ✅ complete |
| 5 | Checkout & pricing engine | ✅ complete |
| 6 | Payments (Paystack + mock) | ✅ complete |
| 7 | Orders + state machine | ✅ complete |
| 8 | Bokku operations dashboard | ✅ complete |
| 9 | Delivery adapters | ✅ complete |
| 10 | Admin | ⬜ |
| 11 | Notifications | ⬜ |
| 12 | Production hardening | ⬜ |
