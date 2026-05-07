#!/bin/sh
# Desbloqueia bases onde uma migração ficou registada como falhada (P3009): marca
# --rolled-back e volta a correr migrate deploy. Migrações conhecidas neste histórico:
# - 20260202120000_add_evolution_api_base_url (baseline / ordem antiga)
# - 20260518140000_inbox_ingest (ex.: gen_random_bytes sem pgcrypto; SQL corrigido + IF NOT EXISTS)
set -e
SCHEMA=apps/api/prisma/schema.prisma

set +e
npx prisma migrate deploy --schema="$SCHEMA" > /tmp/prisma_migrate.out 2>&1
code=$?
set -e
cat /tmp/prisma_migrate.out

if [ "$code" -ne 0 ]; then
  if grep -q P3009 /tmp/prisma_migrate.out; then
    recovered=0
    for STUCK in 20260202120000_add_evolution_api_base_url 20260518140000_inbox_ingest; do
      if grep -q "$STUCK" /tmp/prisma_migrate.out; then
        echo "[docker-entrypoint] Recovering failed migration record (rolled-back): $STUCK"
        npx prisma migrate resolve --rolled-back "$STUCK" --schema="$SCHEMA"
        recovered=1
      fi
    done
    if [ "$recovered" -eq 1 ]; then
      npx prisma migrate deploy --schema="$SCHEMA"
    else
      exit "$code"
    fi
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
