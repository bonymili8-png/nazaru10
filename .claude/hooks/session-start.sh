#!/bin/bash
# Prepares a Claude Code on the web session: dependencies, local Postgres (role + databases for
# dev, tests and E2E) and the shared packages the API and web app import.
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}"

# 1. Dependencies (pnpm via corepack; `install` reuses the cached store).
if ! command -v pnpm >/dev/null 2>&1; then
  corepack enable >/dev/null 2>&1 || npm install -g pnpm@10 >/dev/null
fi
pnpm install --prefer-offline

# 2. Postgres: start the local cluster and make sure the role and databases exist.
if command -v pg_ctlcluster >/dev/null 2>&1 || [ -x /etc/init.d/postgresql ]; then
  if ! pg_isready -h localhost -q; then
    service postgresql start >/dev/null 2>&1 || pg_ctlcluster "$(ls /etc/postgresql | head -1)" main start
    for _ in $(seq 1 30); do pg_isready -h localhost -q && break; sleep 1; done
  fi
  as_postgres() { su postgres -c "psql -v ON_ERROR_STOP=1 -qtAc \"$1\""; }
  if [ -z "$(as_postgres "SELECT 1 FROM pg_roles WHERE rolname='thoroughline'")" ]; then
    as_postgres "CREATE ROLE thoroughline LOGIN SUPERUSER PASSWORD 'thoroughline'"
  fi
  for db in thoroughline thoroughline_test thoroughline_e2e; do
    if [ -z "$(as_postgres "SELECT 1 FROM pg_database WHERE datname='$db'")" ]; then
      as_postgres "CREATE DATABASE $db OWNER thoroughline"
    fi
  done
else
  echo "session-start: Postgres is not installed; API and E2E tests need DATABASE_URL" >&2
fi

# 3. Build the workspace packages (engine, contracts) that the apps import from dist/.
pnpm build:packages
