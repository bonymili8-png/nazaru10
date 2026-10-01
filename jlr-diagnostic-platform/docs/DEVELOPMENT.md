# Development

## Setup

```bash
cd jlr-diagnostic-platform
uv sync                                    # creates .venv with every workspace package (editable) + dev tools
(cd apps/telegram-mini-app && npm ci)
```

Python 3.12+ and uv 0.8+ are required (`uv python install 3.12` if needed). Node 22 for the Mini App.

## Running

| Command | What |
| ------- | ---- |
| `scripts/dev.sh` | Gateway (simulator) :8100, API :8000 (migrates first), Mini App :5173 with `/api` proxy |
| `uv run python -m jlr_gateway` | Gateway only (`GATEWAY_TOKEN` required) |
| `uv run python -m jlr_api migrate` / `serve` / `all` | API migrations / server / both |
| `cd apps/telegram-mini-app && VITE_DEV_AUTH=true npm run dev` | Mini App only |
| `docker compose up --build` | Full stack |

Outside Telegram the Mini App signs in through `/auth/dev` when built with `VITE_DEV_AUTH=true` and the
API has `ALLOW_DEV_AUTH=true`. To test inside Telegram, expose the dev server over HTTPS (e.g. a tunnel)
and set it as the bot's Mini App URL (see [DEPLOYMENT.md](DEPLOYMENT.md)).

## Quality gates

`scripts/check.sh` runs everything CI runs:

```bash
uv run ruff check . && uv run ruff format --check .
uv run mypy packages/*/src apps/api/src apps/diagnostic-gateway/src tests     # strict
uv run pytest
cd apps/telegram-mini-app && npm run lint && npm run typecheck && npm test && npm run build
```

## Database migrations

Models: `apps/api/src/jlr_api/db/models.py`. After changing them:

```bash
export DATABASE_URL=postgresql+asyncpg://jlr:jlr@localhost:5433/jlr_diagnostics
uv run python -m jlr_api migrate                      # bring the DB to head first
uv run python -c "from alembic import command; from jlr_api.__main__ import alembic_config; \
  command.revision(alembic_config(), message='describe change', autogenerate=True)"
```

Review the generated file (`apps/api/src/jlr_api/migrations/versions/`), then run the check script
with `TEST_DATABASE_URL` set — it applies migrations and fails on model/migration drift.

## Conventions

* **No invented support.** New capability checks must map observations to a `CapabilityStatus`
  through `capability_from_error` / explicit evidence. Never probe a mutating service to "see if it
  works".
* **Meaning lives in catalogs.** Do not hardcode manufacturer DIDs, DTC texts or routines; add them to a
  versioned catalog with the right `EvidenceSource`.
* **Mutations** go through `DiagnosticService` with: confirmation, permission, VIN re-check, safety
  check, read-before/verify-after, audit in the API. Add the UDS service to `SERVICE_PERMISSIONS`.
* **Errors**: raise the typed errors from `jlr_shared_types.errors`; never return ad-hoc error dicts.
* **Async**: no blocking I/O in the event loop; bound any concurrency that reaches the vehicle bus.
* **Types**: mypy strict and `tsc --strict` must pass; no `Any` leaks in public interfaces.
* Simulator content is labelled SIMULATION everywhere and must not be presented as real vehicle data.

## Adding a diagnostic interface

Implement the `DiagnosticInterface` protocol (`jlr_diagnostic_core/interface.py`). For a new CAN
adapter it is enough to implement `CanBus` (`open/close/send/recv`) and wrap it in `CANInterface`.
Register it in `apps/diagnostic-gateway/src/jlr_gateway/runtime.py` and `settings.py`, document it in
[HARDWARE.md](HARDWARE.md) with an honest status, and add tests against the simulator where possible.

## Adding a simulator profile

Add a `SimulationProfile` in `packages/simulator/src/jlr_simulator/profiles.py`. Keep addresses, DIDs
and part numbers clearly fictional; generate VINs with `with_check_digit` and a `9xxxxx` serial.
`tests/integration/test_scan_pipeline.py::test_every_simulation_profile_scans_cleanly` covers it
automatically.
