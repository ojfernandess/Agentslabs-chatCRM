#!/bin/sh
# Desbloqueia bases antigas onde a primeira migração incremental falhou antes da baseline existir
# (Prisma P3009 em 20260202120000_add_evolution_api_base_url). Marca como rolled-back e volta a
# correr migrate deploy para aplicar 20260101000000_baseline_schema e o resto em ordem.
set -e
SCHEMA=apps/api/prisma/schema.prisma
STUCK=20260202120000_add_evolution_api_base_url

set +e
npx prisma migrate deploy --schema="$SCHEMA" > /tmp/prisma_migrate.out 2>&1
code=$?
set -e
cat /tmp/prisma_migrate.out

if [ "$code" -ne 0 ]; then
  if grep -q P3009 /tmp/prisma_migrate.out && grep -q "$STUCK" /tmp/prisma_migrate.out; then
    echo "[docker-entrypoint] Recovering failed migration record: $STUCK"
    npx prisma migrate resolve --rolled-back "$STUCK" --schema="$SCHEMA"
    npx prisma migrate deploy --schema="$SCHEMA"
  else
    exit "$code"
  fi
fi

if [ "${RUN_DB_SEED:-false}" = "true" ]; then
  npx tsx apps/api/prisma/seed.ts
fi

UPLOAD_DIR="${MEDIA_UPLOAD_DIR:-/app/uploads/message-media}"
mkdir -p "$UPLOAD_DIR"

exec node apps/api/dist/server.js
