#!/usr/bin/env bash
# Release VO Capture & Control on the VPS.
#
#   ./deploy/release.sh
#
# Order matters: migrate BEFORE the new code serves traffic, or a request can
# hit a column that does not exist yet.
set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE=".env.production"
[[ -f "$ENV_FILE" ]] || { echo "Missing $ENV_FILE — see DEPLOYMENT_GUIDE.md"; exit 1; }

echo "==> Building image"
docker compose --env-file "$ENV_FILE" build

echo "==> Applying migrations"
# Runs against DIRECT_URL. `migrate deploy` never generates or resets; it only
# applies what is already committed, which is what you want on a live database.
docker compose --env-file "$ENV_FILE" run --rm --no-deps app \
  npx prisma migrate deploy

echo "==> Applying pgvector + RLS"
echo "    (idempotent; safe to re-run)"
docker compose --env-file "$ENV_FILE" run --rm --no-deps app \
  sh -c 'npx prisma db execute --file prisma/sql/001_vector.sql --schema prisma/schema.prisma \
      && npx prisma db execute --file prisma/sql/002_rls.sql   --schema prisma/schema.prisma'

echo "==> Starting"
docker compose --env-file "$ENV_FILE" up -d --remove-orphans

echo "==> Waiting for health"
for i in $(seq 1 30); do
  if docker compose --env-file "$ENV_FILE" ps app | grep -q healthy; then
    echo "    healthy"
    exit 0
  fi
  sleep 5
done

echo "!! App did not become healthy. Logs:"
docker compose --env-file "$ENV_FILE" logs --tail=60 app
exit 1
