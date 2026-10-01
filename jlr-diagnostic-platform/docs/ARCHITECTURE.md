# Architecture

## Repository analysis (starting point)

The host repository (`nazaru10`) contained an unrelated TypeScript project — *Thoroughline*, a Telegram
Mini App horse-racing game (NestJS + Next.js + pnpm workspace). Nothing in it was reusable for vehicle
diagnostics except the general Telegram Mini App pattern. To avoid breaking it, the platform lives in
the self-contained `jlr-diagnostic-platform/` directory with its own toolchain (uv for Python, npm for
the Mini App), its own Compose stack and its own CI workflow (path-filtered). The game's root ESLint
and Prettier configs ignore this directory. Splitting it into its own repository later is a `git mv`.

## Layers

```
Telegram Mini App (React)          ── user, mobile-first UI, professional mode
        │ HTTPS /api/v1 (JWT)
Backend API (FastAPI)              ── identity, permissions, persistence, audit, history
        │ HTTP /gw/v1 (shared token)        │
Diagnostic Gateway (FastAPI)        PostgreSQL (SQLAlchemy, Alembic)
        │
DiagnosticService                  ── connect → identify → discover → scan, live data, clear DTC
        │ (application layer: never sees CAN frames)
UDS client / OBD-II                ── ISO 14229-1, SAE J1979
        │
DiagnosticInterface                ── MockInterface | CANInterface | SocketCANInterface | DoIPInterface | J2534Interface
        │
ISO-TP (ISO 15765-2)  |  DoIP (ISO 13400-2)
        │                         │
CAN / CAN-FD bus                  TCP
        │
Simulator  |  SocketCAN adapter  |  DoIP entity
```

Each Python package has one responsibility and only depends downwards:

| Package             | Depends on                                  |
| ------------------- | ------------------------------------------- |
| `shared-types`      | pydantic                                    |
| `protocols`         | shared-types                                |
| `vehicle-model`     | shared-types                                |
| `diagnostic-core`   | shared-types, protocols, vehicle-model      |
| `security`          | shared-types, PyJWT                         |
| `simulator`         | shared-types, protocols, diagnostic-core    |
| `diagnostic-gateway`| core, simulator, FastAPI                    |
| `api`               | core (pure DTC functions), security, FastAPI, SQLAlchemy |

The API never imports the protocol stack's I/O: it talks to the gateway over HTTP using the shared
contracts, so the gateway can run on a laptop next to the vehicle while the API runs elsewhere.

## Key flows

### Connect

1. API `POST /vehicles/connect` (permission `vehicle:connect`) → gateway `POST /gw/v1/connect`.
2. Gateway opens the interface and identifies the vehicle: OBD-II Mode 09 PID 02 and UDS `0xF190`,
   both sent functionally; every answer is a `VinSource`. The majority VIN wins; disagreement is a
   warning (a module from another vehicle).
3. The API creates/updates the `Vehicle` for *this user and this VIN* — the VIN comes from the bus,
   never from the client — and records a `VehicleConnection` and a `DiagnosticOperation`.

### Full scan (`POST /vehicles/{id}/scan`)

1. API checks the gateway is connected to the vehicle's VIN (`VIN_MISMATCH` otherwise).
2. Gateway `DiagnosticService.full_scan()`:
   * passive listen → identifiers in use are excluded from probing;
   * discovery: TesterPresent on candidate addresses, ascending, bounded concurrency (≤ 8);
   * per ECU (concurrency ≤ 4): identification DIDs, `0x19 0x02` DTCs, `0x19 0x08` severity,
     `0x19 0x04` freeze frames, `0x19 0x06` extended data;
   * live-data discovery (OBD bitmaps + catalog DIDs confirmed by a test read);
   * capability classification from the observed responses.
3. API persists a `DiagnosticSession`, ECUs (+ `ECUSoftware` version history), DTCs, `DTCEvent`s
   computed against the previous scan (APPEARED / RESOLVED / STATUS_CHANGED), and live parameters.

### Clear DTCs (the Milestone 1 mutation)

`READ → VALIDATE → WRITE → VERIFY → LOG`:
confirmation flag → permission `dtc:clear` (API **and** transport guard) → live VIN re-check against
the expected VIN → `VehicleSafetyChecker` (voltage, ignition, link stability) → read DTCs → `0x14` →
re-read DTCs → append-only audit entry with old/new value, ECU software version, result.
Blocked and failed attempts are audited too. A backup step does not apply: the DTCs are preserved
in the scan history; the backup engine arrives with configuration writes (Milestone 2).

## Capability & evidence model

Every claim is a `Capability(status, source, evidence, prerequisites)`; every fact (DTC description,
vehicle model, live parameter) carries an `EvidenceSource`: `ECU_RESPONSE`, `ISO_STANDARD`,
`USER_VERIFIED`, `SIMULATION`, `HEURISTIC` or `NONE`. Mapping of UDS negative responses to statuses
is in [PROTOCOLS.md](PROTOCOLS.md#capability-classification). Mutating capabilities (clear, coding,
adaptation, flashing) are never probed and stay `UNKNOWN` until verified.

Meaning is attached to raw identifiers only through versioned **definition catalogs**
(`jlr_diagnostic_core.catalog`): the SAE J2012 generic table (never used for manufacturer ranges),
simulator catalogs (only when the simulator is the interface) and operator-verified JSON catalogs.

## Error model

`jlr_shared_types.errors` defines a typed hierarchy with stable codes (`DiagnosticConnectionError`,
`ProtocolError`, `NegativeResponseError`, `DiagnosticTimeoutError`, `ECUNotFoundError`,
`UnsupportedOperationError`, `SecurityAccessRequiredError`, `CompatibilityError`/`VinMismatchError`,
`LowVoltageError`, `SafetyBlockedError`, `BackupRequiredError`, `VerificationError`, …). Errors cross
the gateway → API boundary as `{"error": {code, message, details}}` and are rebuilt as the same type
(`error_from_payload`). Both services answer with that structure plus a `correlation_id`.

## Concurrency model

* One `DiagnosticService` per gateway owns the bus; operations are serialised by a lock
  (`OPERATION_IN_PROGRESS` instead of interleaving). Concurrency only exists *inside* an operation,
  bounded by configuration (discovery ≤ 8, ECU scan ≤ 4).
* A single `CanFrameRouter` task reads the bus and routes frames to per-ID subscriptions; each ISO-TP
  channel serialises its own messages.
* Everything is `async`; nothing blocks the event loop (SocketCAN uses non-blocking sockets).

## Versioning

| Item                          | Where                                          |
| ----------------------------- | ---------------------------------------------- |
| Public API                    | `/api/v1` prefix                               |
| Gateway API                   | `/gw/v1`, `GATEWAY_PROTOCOL_VERSION = gateway-api/1` |
| Scan result schema            | `ScanResult.schema_version = scan-result/1`, stored per session |
| Vehicle profile schema        | `vehicle-profile/1`, stored per vehicle        |
| Live data schema              | `live-data/1`                                  |
| Definition catalogs           | `name` + `version` + `source` per catalog      |
| Protocol implementations      | `jlr_protocols.PROTOCOL_VERSIONS` (exposed in gateway status) |
| Database                      | Alembic revisions                              |

## Observability

JSON logs with `correlation_id` (from `X-Correlation-ID`, propagated API → gateway),
`diagnostic_session_id` and `operation_id` context variables. `operation_scope` logs the lifecycle
of every diagnostic operation and feeds Prometheus histograms (`/metrics` on both services) and the
error-hook registry (integration point for Sentry or similar). The API additionally persists every
operation in `diagnostic_operations`. Professional mode exposes the raw UDS request/response trace
with per-message timing.

## Decisions

| Decision | Reason |
| -------- | ------ |
| Python for the gateway (not Rust) | One language for protocol engine, simulator and API; asyncio is adequate for diagnostic traffic rates. A Rust transport can replace `CANInterface` behind the same `DiagnosticInterface`. |
| uv workspace with one distribution per package | Enforces the layering; one lockfile; images install only what each service needs. |
| Gateway as a separate process with an HTTP API | The vehicle link and the cloud API have different trust zones and lifecycles. |
| Alembic migrations inside `apps/api` (not `database/migrations`) | Migrations ship in the API image with the models they belong to; no seeds are needed in Milestone 1. |
| No Redis in Milestone 1 | Single API process; the rate limiter is in-process. Redis comes with multi-instance deployment. |
| `services/worker`, `services/ai-diagnostics` not created | No placeholder code; they arrive with the milestones that need them. |
| HashRouter in the Mini App | Works from any static host and inside Telegram's WebView without server rewrites. |
| Hand-written SVG charts | No chart dependency for two small visuals. |
