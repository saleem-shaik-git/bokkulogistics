#!/usr/bin/env bash
# Reinstalls local dev services (PostgreSQL 16 + Redis 7) into
# <repo>/.services without needing Docker or apt (both unavailable in the
# sandbox). Safe to re-run; existing installs/data are reused.
#
#   ./scripts/setup-dev-services.sh           # install if missing
#   ./scripts/setup-dev-services.sh --force   # reinstall binaries from scratch
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SVC="$ROOT/.services"
PG_DIR="$SVC/pgsql"
REDIS_DIR="$SVC/redis"
PGDATA="$SVC/pgdata"
PG_PORT=5432
REDIS_PORT=6379

mkdir -p "$SVC"

if [[ "${1:-}" == "--force" ]]; then
  rm -rf "$PG_DIR" "$REDIS_DIR" "$PGDATA"
fi

# ── PostgreSQL 16 binaries (via the `pgserver` PyPI wheel — manylinux) ──
if [[ ! -x "$PG_DIR/bin/postgres" ]]; then
  echo "==> Downloading PostgreSQL binaries (pgserver wheel from PyPI)"
  WHEEL_DIR="$(mktemp -d)"
  pip3 download pgserver --no-deps -d "$WHEEL_DIR" --quiet
  WHEEL="$(ls "$WHEEL_DIR"/*.whl | head -1)"
  python3 -m zipfile -e "$WHEEL" "$WHEEL_DIR/extracted"
  mkdir -p "$PG_DIR"
  cp -r "$WHEEL_DIR/extracted/pgserver/pginstall/"* "$PG_DIR/"
  cp -r "$WHEEL_DIR/extracted/pgserver.libs/"* "$PG_DIR/lib/" 2>/dev/null || true
  chmod -R +x "$PG_DIR/bin"
  rm -rf "$WHEEL_DIR"
fi
export LD_LIBRARY_PATH="$PG_DIR/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export PATH="$PG_DIR/bin:$REDIS_DIR/bin:$PATH"
echo "==> $("$PG_DIR/bin/postgres" --version)"

# ── Redis 7 (compiled from source; tarball via GitHub codeload) ─────────
if [[ ! -x "$REDIS_DIR/bin/redis-server" ]]; then
  echo "==> Building Redis 7.2 from source (first run takes ~2 min)"
  BUILD="$(mktemp -d)"
  curl -sL --max-time 300 -o "$BUILD/redis.tar.gz" \
    "https://github.com/redis/redis/archive/refs/tags/7.2.10.tar.gz"
  tar xzf "$BUILD/redis.tar.gz" -C "$BUILD"
  make -C "$BUILD/redis-7.2.10" -j"$(nproc)" MALLOC=libc >/dev/null
  mkdir -p "$REDIS_DIR/bin"
  cp "$BUILD/redis-7.2.10/src/redis-server" "$BUILD/redis-7.2.10/src/redis-cli" "$REDIS_DIR/bin/"
  rm -rf "$BUILD"
fi
echo "==> $("$REDIS_DIR/bin/redis-server" --version | head -1)"

# ── Database cluster + role ──────────────────────────────────────────────
if [[ ! -d "$PGDATA/base" ]]; then
  echo "==> Initializing PostgreSQL data directory"
  initdb -D "$PGDATA" --username=postgres --no-locale -E UTF8 \
    --auth-local=trust --auth-host=scram-sha-256 >/dev/null
fi

echo "==> Starting PostgreSQL on :$PG_PORT"
pg_ctl -D "$PGDATA" -l "$SVC/postgres.log" -o "-p $PG_PORT -c listen_addresses=127.0.0.1" -w -t 60 start \
  || pg_ctl -D "$PGDATA" status || true

echo "==> Starting Redis on :$REDIS_PORT"
mkdir -p "$SVC/redis-data"
if ! "$REDIS_DIR/bin/redis-cli" -p "$REDIS_PORT" ping >/dev/null 2>&1; then
  "$REDIS_DIR/bin/redis-server" --port "$REDIS_PORT" --bind 127.0.0.1 \
    --dir "$SVC/redis-data" --save '' --appendonly no --daemonize yes --logfile "$SVC/redis.log"
fi

# ── Role + databases (idempotent) ────────────────────────────────────────
PGSOCK="/tmp"
psql -h "$PGSOCK" -p "$PG_PORT" -U postgres -d postgres <<'SQL'
DO $$ BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'bokku') THEN
    CREATE ROLE bokku LOGIN PASSWORD 'bokku_dev_password';
  END IF;
END $$;
SQL
for DB in bokku_dev bokku_test; do
  psql -h "$PGSOCK" -p "$PG_PORT" -U postgres -d postgres -tc \
    "SELECT 1 FROM pg_database WHERE datname='$DB'" | grep -q 1 \
    || psql -h "$PGSOCK" -p "$PG_PORT" -U postgres -d postgres -c "CREATE DATABASE $DB OWNER bokku"
done

echo "==> Verifying password authentication"
PGPASSWORD=bokku_dev_password psql -h 127.0.0.1 -p "$PG_PORT" -U bokku -d bokku_dev -t -c \
  "SELECT 'connected as ' || current_user || ' to ' || current_database();"
"$REDIS_DIR/bin/redis-cli" -p "$REDIS_PORT" ping

echo ""
echo "✓ Dev services ready (PostgreSQL :$PG_PORT, Redis :$REDIS_PORT)"
echo "  Data:   $PGDATA"
echo "  Logs:   $SVC/postgres.log, $SVC/redis.log"
