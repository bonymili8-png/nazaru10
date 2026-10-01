# Security

## Scope and boundary

The platform is for legal diagnostics and configuration of vehicles the user is entitled to work on.
The following are **out of scope and not implemented**, by design:

* computing, guessing, brute-forcing or extracting security-access keys, seeds or credentials;
* bypassing immobilizer, anti-theft, secure gateway, component protection or OEM authentication;
* exploiting ECU vulnerabilities, hidden token capture, disabling anti-theft functions.

When an ECU or DoIP entity demands authentication, the platform reports `OEM_AUTH_REQUIRED` and stops.
The only path to security access is an authorised `SecurityKeyProvider` (e.g. an OEM-sanctioned
service); none ships with the platform, and `SecurityAccessManager` makes exactly one attempt per ECU
and level and never retries after `invalidKey`, `exceededNumberOfAttempts` or `requiredTimeDelay`.

## Identity and authentication

1. The Mini App sends Telegram `initData` to `POST /api/v1/auth/telegram`.
2. The API verifies the HMAC-SHA256 signature with the bot token (`secret = HMAC("WebAppData",
   bot_token)`), rejects duplicates, oversize payloads, expired (`INIT_DATA_MAX_AGE_SECONDS`) or
   future `auth_date`.
3. The API issues a short-lived JWT (HS256, `iss`/`aud`/`exp`/`jti`, ≥ 32-byte secret).
4. Each request re-loads the user; role and active flag come from the database, never from the token
   or the client.

`POST /auth/dev` exists only when `ALLOW_DEV_AUTH=true` and the environment is not `production`; the
API refuses to start in production with dev auth enabled, without a bot token or with a placeholder
JWT secret.

## Authorization

| Permission            | viewer | technician | admin |
| --------------------- | :----: | :--------: | :---: |
| vehicle:read          | ✓      | ✓          | ✓     |
| vehicle:connect       |        | ✓          | ✓     |
| diagnostic:scan       |        | ✓          | ✓     |
| live_data:read        |        | ✓          | ✓     |
| dtc:clear             |        | ✓          | ✓     |
| audit:read_all        |        |            | ✓     |
| uds:write_data, uds:routine_control, uds:ecu_reset, uds:communication_control, uds:security_access, uds:memory_read, uds:transfer | — | — | — |

The security-sensitive UDS permissions are granted to **no role** in Milestone 1. They are enforced at
the lowest level: `GuardedTransport` inspects every request PDU before it reaches the vehicle
(`0x11, 0x14, 0x23, 0x27, 0x28, 0x2E, 0x31, 0x34–0x37`, and `0x10 0x02` programming session), so no
code path can send them without the permission. Users only see their own vehicles.

## Never trust the client

* The VIN is read from the vehicle by the gateway; a vehicle record is keyed by (owner, VIN read on
  the bus).
* Every vehicle operation re-checks that the gateway is connected to that VIN (`VIN_MISMATCH`).
* Clearing DTCs re-reads the VIN from the bus immediately before writing.
* Request bodies are validated with `extra="forbid"` models and length limits; unknown fields fail.

## Gateway

The gateway API requires `X-Gateway-Token` (or `Authorization: Bearer`) compared in constant time;
placeholder or short tokens are rejected at start-up. Simulator fault-injection routes exist only with
the mock interface and can be disabled (`GATEWAY_SIM_CONTROL_ENABLED=false`). The gateway is not
exposed to the host in `docker-compose.yml`; in a split deployment put it behind a private network
(WireGuard/Tailscale/mTLS reverse proxy).

## Vehicle safety

`VehicleSafetyChecker` gates every mutation: interface connected, link stable (consecutive failures
with known ECUs), voltage thresholds by risk (low-risk write ≥ 11.5 V, configuration ≥ 12.2 V, flashing
≥ 12.8 V, ≤ 15.5 V; unknown voltage blocks configuration/flashing), ignition state. Thresholds are
conservative engineering defaults, configurable, not OEM specifications.

## Audit

`audit_logs` records user, Telegram ID, timestamp, VIN, ECU, operation, old/new value, request,
response, result (`SUCCESS`/`FAILED`/`BLOCKED`), error, ECU software version and correlation ID. It is
written in its own transaction (failures are recorded too). PostgreSQL triggers reject `UPDATE`,
`DELETE` and `TRUNCATE`; there is no API to modify it. Users read their own entries; admins can read
all.

## Other controls

* Rate limits per user: auth 20/min (per IP), scan/connect 6/min, mutation 10/min, live data 240/min.
* CSV exports neutralise spreadsheet formulas (`=`, `+`, `-`, `@`).
* nginx: CSP (scripts only from self and telegram.org; `frame-ancestors` limited to Telegram),
  `nosniff`, `no-referrer`; API responses are `Cache-Control: no-store`.
* Secrets only via environment; `.env` is git-ignored; `.env.example` holds no secrets.
* Encryption in transit is provided by the TLS-terminating reverse proxy in production
  ([DEPLOYMENT.md](DEPLOYMENT.md)); PostgreSQL volume encryption is an infrastructure concern.

## Reporting

Report vulnerabilities privately to the repository owner; do not open public issues for them.
