#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Bokku Logistics — final MVP acceptance run.
#
# Walks the full platform journey against a LIVE dev stack: customer
# browse → cart → address → server-priced checkout → mock payment →
# order → staff fulfillment → auto-dispatch → courier fast-forward →
# delivered → notifications → admin oversight, plus security spot-checks.
#
# Usage:
#   ./scripts/acceptance-mvp.sh                # API :4000 / web :3000
#   API=http://host:4000 WEB=http://host:3000 ./scripts/acceptance-mvp.sh
#
# Dependencies: curl + jq. Courier fast-forward needs a redis-cli for the
# DEV redis (uses $REDIS_CLI, PATH's redis-cli, or .services/redis/bin).
# The seeded staff accounts come from `pnpm db:seed`.
# ─────────────────────────────────────────────────────────────────────────────
set -u

API=${API:-http://127.0.0.1:4000}
WEB=${WEB:-http://127.0.0.1:3000}
V1="$API/api/v1"
PASS=0
FAIL=0
EMAIL="accept-$(date +%s)@bokku.test"
CUSTOMER_PASSWORD='Acceptance1!'
BODY_FILE=$(mktemp)
trap 'rm -f "$BODY_FILE"' EXIT

REDIS_CLI=${REDIS_CLI:-}
if [ -z "$REDIS_CLI" ]; then
  if command -v redis-cli >/dev/null 2>&1; then REDIS_CLI=$(command -v redis-cli);
  elif [ -x ".services/redis/bin/redis-cli" ]; then REDIS_CLI=".services/redis/bin/redis-cli";
  elif [ -x "$(dirname "$0")/../.services/redis/bin/redis-cli" ]; then REDIS_CLI="$(dirname "$0")/../.services/redis/bin/redis-cli"; fi
fi

step() { printf '[%02d] %s' "$1" "$2"; }
ok() { PASS=$((PASS+1)); printf '  ✔ %s\n' "$1"; }
fail() { FAIL=$((FAIL+1)); printf '  ✘ %s\n' "$1"; }

# req METHOD PATH [TOKEN] [BODY_JSON] — sets global HTTP_CODE, body lands in $BODY_FILE.
req() {
  local method=$1 path=$2 token=${3:-} body=${4:-}
  local -a extra=()
  [ -n "$token" ] && extra+=(-H "authorization: Bearer $token")
  if [ -n "$body" ]; then extra+=(-H 'content-type: application/json' -d "$body"); fi
  # NOTE: always pass -X/--request as separate entry; "$extra[@]" keeps
  # headers intact. Prints ONLY the status code.
  HTTP_CODE=$(curl -s -o "$BODY_FILE" -w '%{http_code}' -X "$method" "${extra[@]}" "$V1$path")
}

expect() { # expect <code> <desc>
  if [ "$HTTP_CODE" = "$1" ]; then ok "$2 (HTTP $HTTP_CODE)";
  else fail "$2 (expected $1, got $HTTP_CODE: $(head -c 160 "$BODY_FILE" 2>/dev/null))"; fi
}
jqv() { jq -r "$1" "$BODY_FILE" 2>/dev/null; }

STEP=0
step $((STEP+=1)) "API core health"; req GET /health
[ "$HTTP_CODE" = 200 ] && [ "$(jqv '.status')" = ok ] && ok "status ok" || fail "core health ($HTTP_CODE)"

step $((STEP+=1)) "liveness probe"; req GET /health/live
expect 200 "live"

step $((STEP+=1)) "readiness probe"; req GET /health/ready
expect 200 "ready"

step $((STEP+=1)) "web storefront serves"
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$WEB/")
expect 200 "storefront"

step $((STEP+=1)) "register fresh customer"; req POST /auth/register '' "{\"email\":\"$EMAIL\",\"password\":\"$CUSTOMER_PASSWORD\",\"firstName\":\"Accept\",\"lastName\":\"Runner\"}"
expect 201 "registered"

step $((STEP+=1)) "login"
req POST /auth/login '' "{\"email\":\"$EMAIL\",\"password\":\"$CUSTOMER_PASSWORD\"}"
expect 200 "logged in"
CT=$(jqv '.data.tokens.accessToken')
[ "$CT" != null ] && [ -n "$CT" ] || fail "no access token"

step $((STEP+=1)) "catalogue: stores"; req GET /stores
expect 200 "stores listed"
STORE_ID=$(jqv '.data.data[0].id')
[ "${STORE_ID:-null}" != null ] || fail "no store"

step $((STEP+=1)) "catalogue: products"; req GET "/stores/$STORE_ID/products?limit=20"
expect 200 "products listed"
P1=$(jqv '[.data.data[].id][0]'); P2=$(jqv '[.data.data[].id][1]')
[ "${P1:-null}" != null ] || fail "no products"

step $((STEP+=1)) "cart: add item A ×2"; req POST /cart/items "$CT" "{\"productId\":\"$P1\",\"quantity\":2}"
expect 201 "added"

step $((STEP+=1)) "cart: add item B"; req POST /cart/items "$CT" "{\"productId\":\"$P2\",\"quantity\":1}"
expect 201 "added"

step $((STEP+=1)) "cart persists server-side"; req GET /cart "$CT"
[ "$(jqv '.data.items | length')" = 2 ] && ok "2 lines remembered" || fail "items=$(jqv '.data.items | length')"

step $((STEP+=1)) "address: create"
req POST /addresses "$CT" '{"label":"Acceptance","street":"15 Acceptance Crescent","city":"Lagos","state":"Lagos","isDefault":true}'
expect 201 "saved"
ADDR_ID=$(jqv '.data.id')

step $((STEP+=1)) "checkout preview: server-side totals"; req POST /checkout/preview "$CT" "{\"addressId\":\"$ADDR_ID\"}"
expect 201 "preview computed"
TOTAL=$(jqv '.data.total'); FEE=$(jqv '.data.deliveryFee')
if [ "${TOTAL:-null}" != null ] && [ "$TOTAL" -gt 0 ] 2>/dev/null; then ok "total=${TOTAL}k fee=${FEE}k (server-authoritative)"; else fail "bad totals ($TOTAL/$FEE)"; fi

step $((STEP+=1)) "payment initialize"; req POST /payments/initialize "$CT" "{\"addressId\":\"$ADDR_ID\"}"
expect 201 "payment created"
PAY_REF=$(jqv '.data.reference')
[ "${PAY_REF:-null}" != null ] || fail "no reference"

step $((STEP+=1)) "mock provider settles the payment"; req POST /payments/mock/complete '' "{\"reference\":\"$PAY_REF\",\"outcome\":\"success\"}"
expect 201 "settled"
[ "$(jqv '.data.status')" = SUCCESS ] && ok "status SUCCESS" || fail "status=$(jqv '.data.status')"

step $((STEP+=1)) "order from settled payment"; req POST /orders "$CT" "{\"paymentReference\":\"$PAY_REF\"}"
expect 201 "order placed"
ORDER_ID=$(jqv '.data.id'); ORDER_NO=$(jqv '.data.orderNumber')
[ "$(jqv '.data.status')" = PAID ] && ok "PAID ($ORDER_NO)" || fail "status=$(jqv '.data.status')"

step $((STEP+=1)) "order placement is idempotent"; req POST /orders "$CT" "{\"paymentReference\":\"$PAY_REF\"}"
[ "$(jqv '.data.id')" = "$ORDER_ID" ] && ok "same order id" || fail "different id"

step $((STEP+=1)) "customer order list"; req GET /orders "$CT"
jqv '[.data.data[].id] | map(select(. == "'"$ORDER_ID"'")) | length' | grep -q '^1$' && ok "listed" || fail "missing"

step $((STEP+=1)) "staff login"; req POST /auth/login '' '{"email":"manager@bokku.test","password":"Password123!"}'
expect 200 "manager in"
MT=$(jqv '.data.tokens.accessToken')

step $((STEP+=1)) "staff: PAID→CONFIRMED"; req PATCH "/bokku/orders/$ORDER_ID/status" "$MT" '{"status":"CONFIRMED"}'
expect 200 "CONFIRMED"

step $((STEP+=1)) "staff: →PREPARING"; req PATCH "/bokku/orders/$ORDER_ID/status" "$MT" '{"status":"PREPARING"}'
expect 200 "PREPARING"

step $((STEP+=1)) "staff: →READY_FOR_PICKUP (auto-dispatch)"; req PATCH "/bokku/orders/$ORDER_ID/status" "$MT" '{"status":"READY_FOR_PICKUP"}'
expect 200 "READY_FOR_PICKUP"

step $((STEP+=1)) "customer tracking live"; req GET "/orders/$ORDER_ID/tracking" "$CT"
expect 200 "tracking"
EXT_ID=$(jqv '.data.externalId')
[ "${EXT_ID:-null}" != null ] && ok "delivery $EXT_ID dispatched" || fail "no external id"

step $((STEP+=1)) "notification: order.paid in feed"; req GET /notifications "$CT"
jqv '.data.data[].type' | grep -q '^order\.paid$' && ok "present" || fail "missing"

if [ -z "$REDIS_CLI" ]; then
  fail "redis-cli missing — cannot fast-forward courier"
else
  step $((STEP+=1)) "fast-forward mock courier 150s"
  PAST=$(date -u -d '150 seconds ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-150S +%Y-%m-%dT%H:%M:%SZ)
  AGED=$("$REDIS_CLI" GET "mockdel:$EXT_ID" | jq -c --arg past "$PAST" '.dispatchedAt = $past')
  # Inline value arg — `redis-cli -x` appends stdin AFTER options, which
  # would corrupt `SET key <stdin> KEEPTTL` ordering ("ERR syntax error").
  SET_OUT=$("$REDIS_CLI" SET "mockdel:$EXT_ID" "$AGED" KEEPTTL)
  [ "$SET_OUT" = OK ] && ok "record aged" || fail "redis SET: $SET_OUT"
fi

step $((STEP+=1)) "tracking read completes the delivery"; req GET "/orders/$ORDER_ID/tracking" "$CT"
if [ "$(jqv '.data.status')" = DELIVERED ]; then ok "DELIVERED (courier: $(jqv '.data.courier.name') )"; else fail "status=$(jqv '.data.status')"; fi

step $((STEP+=1)) "order reached DELIVERED"; req GET "/orders/$ORDER_ID" "$CT"
[ "$(jqv '.data.status')" = DELIVERED ] && ok "DELIVERED" || fail "status=$(jqv '.data.status')"

step $((STEP+=1)) "delivery journey events in feed"; req GET /notifications "$CT"
TYPES=$(jqv '.data.data[].type')
echo "$TYPES" | grep -q '^delivery\.delivered$' && echo "$TYPES" | grep -q '^delivery\.driver_assigned$' \
  && ok "driver_assigned + delivered present" || fail "events: $TYPES"

step $((STEP+=1)) "mark-all-read drains the badge"; req POST /notifications/read-all "$CT"
expect 201 "read-all"
req GET /notifications/unread-count "$CT"
[ "$(jqv '.data.unread')" = 0 ] && ok "badge = 0" || fail "unread=$(jqv '.data.unread')"

step $((STEP+=1)) "preferences merge-patch"; req PATCH /notifications/preferences "$CT" '{"deliveryUpdates":false}'
expect 200 "patched"
[ "$(jqv '.data.deliveryUpdates')" = false ] && [ "$(jqv '.data.orderUpdates')" = true ] && ok "merge held" || fail "prefs wrong"
req PATCH /notifications/preferences "$CT" '{"deliveryUpdates":true}'

step $((STEP+=1)) "admin login"; req POST /auth/login '' '{"email":"admin@bokku.test","password":"Password123!"}'
expect 200 "admin in"
ADMIN_T=$(jqv '.data.tokens.accessToken')

step $((STEP+=1)) "admin dashboard aggregates"; req GET /admin/dashboard "$ADMIN_T"
expect 200 "dashboard"

step $((STEP+=1)) "admin sees this order cross-store"; req GET "/admin/orders/$ORDER_ID" "$ADMIN_T"
expect 200 "order detail"

step $((STEP+=1)) "audit trail recorded order actions"; req GET "/admin/audit-logs?action=order&limit=5" "$ADMIN_T"
jqv '.data.data[].action' | grep -q '^order\.' && ok "order.* rows present" || fail "no rows"

step $((STEP+=1)) "security: anonymous → 401"
HTTP_CODE=$(curl -s -o /dev/null -w '%{http_code}' "$V1/orders")
expect 401 "anon blocked"

step $((STEP+=1)) "security: customer → 403 on staff surface"; req GET /bokku/orders "$CT"
expect 403 "RBAC blocked"

step $((STEP+=1)) "security: 404 envelope + echoed request id"
HTTP_CODE=$(curl -s -o "$BODY_FILE" -D /tmp/accept-hdrs -w '%{http_code}' "$V1/definitely-not-a-route" -H 'x-request-id: mvp-acceptance-1')
grep -qi 'x-request-id: mvp-acceptance-1' /tmp/accept-hdrs && [ "$(jqv '.success')" = false ] && ok "envelope+id consistent ($HTTP_CODE)" || fail "plumbing"

printf '\n─────────────────────────────────────────────\nACCEPTANCE: %d passed, %d failed\n' "$PASS" "$FAIL"
[ "$FAIL" = 0 ]
