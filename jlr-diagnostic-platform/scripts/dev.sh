#!/usr/bin/env bash
# Local development without Docker: gateway (simulator) + API + Mini App dev server.
# Requires PostgreSQL reachable at DATABASE_URL (default below) — e.g. `docker compose up -d postgres`.
set -euo pipefail
cd "$(dirname "$0")/.."

export DATABASE_URL="${DATABASE_URL:-postgresql+asyncpg://jlr:jlr@localhost:5433/jlr_diagnostics}"
export JWT_SECRET="${JWT_SECRET:-dev-only-jwt-secret-change-me-0123456789}"
export GATEWAY_TOKEN="${GATEWAY_TOKEN:-dev-only-gateway-token-change-me}"
export GATEWAY_URL="${GATEWAY_URL:-http://127.0.0.1:8100}"
export ALLOW_DEV_AUTH="${ALLOW_DEV_AUTH:-true}"
export DEFAULT_ROLE="${DEFAULT_ROLE:-technician}"
export LOG_JSON="${LOG_JSON:-false}"
export GATEWAY_LOG_JSON="${GATEWAY_LOG_JSON:-false}"

uv sync
(cd apps/telegram-mini-app && [[ -d node_modules ]] || npm ci)

trap 'kill 0' EXIT
GATEWAY_HOST=127.0.0.1 uv run python -m jlr_gateway &
API_HOST=127.0.0.1 uv run python -m jlr_api all &
(cd apps/telegram-mini-app && VITE_DEV_AUTH=true npm run dev) &
wait
