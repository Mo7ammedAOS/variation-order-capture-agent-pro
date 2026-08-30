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
#
# Uses the `migrate` service, which is the BUILD stage: the runner has no
# complete node_modules, so the Prisma CLI there cannot load its own
# dependencies.
docker compose --env-file "$ENV_FILE" --profile tools run --rm --no-deps migrate

# pgvector indexes and RLS policies are MIGRATIONS now, applied by the step
# above. They used to be run here from prisma/sql/*.sql, which meant a database
# rebuilt from `migrate deploy` alone came up with row level security disabled
# and no policies — silently. Those files no longer exist, so this step would
# have failed the release outright.

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
