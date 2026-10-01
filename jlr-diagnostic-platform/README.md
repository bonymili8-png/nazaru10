# JLR Diagnostic Platform

Simulation-first platform for diagnosing, monitoring and (in later milestones) configuring Land Rover /
Range Rover vehicles, operated from a Telegram Mini App.

```
Vehicle ─ OBD / CAN / CAN-FD / DoIP ─► Diagnostic Gateway ─► Backend API ─► PostgreSQL
                                       (protocol engine,        │
                                        ECU abstraction)        └─► Telegram Mini App
```

> **Status — Milestone 1 complete (simulation).** Everything below runs end to end against the
> built-in `JLRVehicleSimulator`. The SocketCAN and DoIP interfaces are implemented but **have not been
> validated on a real vehicle**; J2534 is not implemented yet. Simulator profiles are invented test
> data, not statements about real JLR ECUs. See [docs/ROADMAP.md](docs/ROADMAP.md).

## Quick start

Requirements: Docker with Compose v2.

```bash
cd jlr-diagnostic-platform
docker compose up --build
```

Then open <http://localhost:8080> — the Mini App signs in with a development account (outside
Telegram), connects to the simulated Range Rover, and you can run a full scan, browse ECUs and DTCs,
clear DTCs (with safety check and audit) and stream live data.

| Service  | URL / port                                  | Notes                                           |
| -------- | ------------------------------------------- | ----------------------------------------------- |
| web      | <http://localhost:8080>                     | Mini App (nginx), proxies `/api` to the API     |
| api      | <http://localhost:8000/api/v1/docs>         | OpenAPI UI; migrations run on start             |
| gateway  | internal `gateway:8100`                     | mock interface (simulator), token-protected     |
| postgres | `localhost:5433`                            | user/password/db `jlr`/`jlr`/`jlr_diagnostics`  |

Smoke test of the running stack (sign in → connect → scan → live data):

```bash
scripts/smoke.sh http://localhost:8080
```

Behind a TLS-intercepting proxy, pass its CA bundle to the image builds:
`EXTRA_CA_CERT=/path/to/ca.pem docker compose build`.

Other simulation profiles: `GATEWAY_SIM_PROFILE=defender docker compose up` (`range_rover`,
`range_rover_sport`, `defender`, `discovery`, `discovery_sport`, `evoque`).

## Local development (without Docker)

Requirements: Python 3.12+, [uv](https://docs.astral.sh/uv/) 0.8+, Node.js 22, PostgreSQL 16.

```bash
uv sync                                   # Python workspace (all packages + dev tools)
(cd apps/telegram-mini-app && npm ci)     # Mini App
docker compose up -d postgres             # or any PostgreSQL; see scripts/dev.sh for DATABASE_URL
scripts/dev.sh                            # gateway :8100 + API :8000 + Mini App dev server :5173
```

## Verify

```bash
scripts/check.sh                          # ruff, ruff format, mypy --strict, pytest, ESLint, tsc, vitest, build
TEST_DATABASE_URL=postgresql+asyncpg://jlr:jlr@localhost:5432/jlr_test scripts/check.sh   # + PostgreSQL & migrations
```

## Repository layout

| Path                         | Contents                                                                    |
| ---------------------------- | --------------------------------------------------------------------------- |
| `packages/shared-types`      | Versioned contracts, capability model, typed error model, permissions      |
| `packages/protocols`         | CAN/CAN-FD frames, ISO-TP, UDS (codec + client), OBD-II, DoIP              |
| `packages/diagnostic-core`   | `DiagnosticInterface` + transports, discovery, DTC engine, live data, safety, `DiagnosticService` |
| `packages/vehicle-model`     | VIN validation/decoding, version-aware vehicle profile                     |
| `packages/security`          | Telegram `initData` verification, JWT access tokens, rate limiter          |
| `packages/simulator`         | `JLRVehicleSimulator`: virtual CAN bus, UDS/OBD ECUs, DoIP entity, faults  |
| `apps/diagnostic-gateway`    | Gateway service that owns the vehicle connection (FastAPI, internal API)   |
| `apps/api`                   | Public REST API, SQLAlchemy models, Alembic migrations                     |
| `apps/telegram-mini-app`     | React + TypeScript + Vite Mini App                                         |
| `tests/`                     | `protocol`, `unit`, `integration`, `simulation` (failures), `api`          |
| `docker/`, `docker-compose.yml` | Images (API, gateway, nginx + Mini App) and the local stack              |
| `docs/`                      | Architecture, protocols, API, security, hardware, testing, deployment     |

## Documentation

[Architecture](docs/ARCHITECTURE.md) · [Roadmap](docs/ROADMAP.md) · [API](docs/API.md) ·
[Protocols](docs/PROTOCOLS.md) · [Security](docs/SECURITY.md) · [Hardware](docs/HARDWARE.md) ·
[Development](docs/DEVELOPMENT.md) · [Testing](docs/TESTING.md) · [Deployment](docs/DEPLOYMENT.md) ·
[Troubleshooting](docs/TROUBLESHOOTING.md)

## Principles

* **No invented support.** Every capability is `SUPPORTED`, `SUPPORTED_WITH_PREREQUISITES`,
  `HARDWARE_REQUIRED`, `OEM_AUTH_REQUIRED`, `UNKNOWN` or `NOT_SUPPORTED`, with the evidence it came from.
  Without evidence it is `UNKNOWN`. Write capabilities are never probed.
* **Legal access only.** No key brute-forcing, immobilizer/gateway/component-protection bypass or
  credential extraction. ECUs that need OEM authentication are reported as `OEM_AUTH_REQUIRED`.
  See [docs/SECURITY.md](docs/SECURITY.md).
* **Safe by construction.** Mutations go through permission checks at the transport boundary, VIN
  re-verification, a vehicle safety check (voltage, ignition, link stability), explicit confirmation
  and an append-only audit log.
