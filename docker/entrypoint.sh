#!/usr/bin/env sh
set -eu

mkdir -p /app/data

# Runtime config. These intentionally override anything baked at build time
# so the same image works on any host with no edits.
export NODE_ENV="${NODE_ENV:-production}"
export DATABASE_URL="${DATABASE_URL:-file:/app/data/dev.db}"
export PORT="${PORT:-4000}"
export FRONTEND_ORIGIN="${FRONTEND_ORIGIN:-*}"
export WEBSOCKET_CORS_ORIGIN="${WEBSOCKET_CORS_ORIGIN:-*}"

# Sync schema. No migrations dir exists — schema-only workflow.
# `db push` is idempotent: creates the DB on first run, no-op afterwards.
cd /app/backend
npx --no-install prisma db push --skip-generate --accept-data-loss
cd /app

exec /usr/bin/supervisord -c /etc/supervisord.conf
