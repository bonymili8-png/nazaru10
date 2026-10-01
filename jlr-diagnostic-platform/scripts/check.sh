#!/usr/bin/env bash
# Runs every quality gate: lint, format, type checking, tests and the Mini App build.
# Usage: scripts/check.sh            (Python tests on SQLite)
#        TEST_DATABASE_URL=postgresql+asyncpg://jlr:jlr@localhost:5432/jlr_test scripts/check.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PY_SRC=(packages/*/src apps/api/src apps/diagnostic-gateway/src tests)

echo "==> Python: ruff lint"
uv run ruff check .
echo "==> Python: ruff format"
uv run ruff format --check .
echo "==> Python: mypy (strict)"
uv run mypy "${PY_SRC[@]}"
if [[ -n "${TEST_DATABASE_URL:-}" ]]; then
  echo "==> Database: alembic upgrade head + drift check"
  DATABASE_URL="$TEST_DATABASE_URL" uv run python -c "
from alembic import command
from jlr_api.__main__ import alembic_config
config = alembic_config()
command.upgrade(config, 'head')
command.check(config)
"
fi
echo "==> Python: pytest"
uv run pytest -q

echo "==> Mini App: lint, typecheck, test, build"
cd apps/telegram-mini-app
[[ -d node_modules ]] || npm ci --no-audit --no-fund
npm run lint
npm run typecheck
npm test
npm run build
echo "All checks passed."
