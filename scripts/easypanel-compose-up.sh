#!/usr/bin/env sh
# EasyPanel: build API image before long web build, then start stack.
# Settings → Compose command (or custom deploy):
#   sh scripts/easypanel-compose-up.sh
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

COMPOSE_FILES="-f docker-compose.yml"
if [ -f docker-compose.override.yml ]; then
  COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.override.yml"
fi
COMPOSE_FILES="$COMPOSE_FILES -f docker-compose.easypanel.yml"

# shellcheck disable=SC2086
docker compose $COMPOSE_FILES build api worker web
# shellcheck disable=SC2086
docker compose $COMPOSE_FILES up -d
