#!/bin/sh
set -e
# Migrations use the superuser URL so RLS FORCE does not block DDL.
if [ -n "$DATABASE_MIGRATE_URL" ]; then
  DATABASE_URL="$DATABASE_MIGRATE_URL" npx prisma migrate deploy
fi
if [ "$RUN_DB_SEED" = "true" ]; then
  DATABASE_MIGRATE_URL="${DATABASE_MIGRATE_URL:-$DATABASE_URL}" npx tsx prisma/seed.ts
fi
exec node dist/main.js
