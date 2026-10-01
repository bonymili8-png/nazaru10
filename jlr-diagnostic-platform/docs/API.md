# API

Interactive OpenAPI docs: `http://localhost:8000/api/v1/docs` (public API) and
`http://<gateway>:8100/gw/docs` (gateway). All public routes are under `/api/v1` and, except the
health and auth routes, require `Authorization: Bearer <token>`.

## Errors

Every error, from validation to the vehicle bus, has the same shape:

```json
{ "error": { "code": "VIN_MISMATCH", "message": "The gateway is connected to a different vehicle",
             "details": { "vehicle_vin": "SAL…", "connected_vin": "SAL…" }, "correlation_id": "4f…" } }
```

| Code | HTTP | Code | HTTP |
| ---- | ---- | ---- | ---- |
| AUTH_REQUIRED | 401 | NOT_CONNECTED | 409 |
| PERMISSION_DENIED | 403 | VIN_MISMATCH | 409 |
| SECURITY_ACCESS_REQUIRED | 403 | LOW_VOLTAGE / SAFETY_BLOCKED | 409 |
| NOT_FOUND / ECU_NOT_FOUND | 404 | OPERATION_IN_PROGRESS | 409 |
| VALIDATION_ERROR / UNSUPPORTED_OPERATION | 422 | CONFIRMATION_REQUIRED | 428 |
| RATE_LIMITED | 429 | PROTOCOL_ERROR / NEGATIVE_RESPONSE | 502 |
| GATEWAY_UNAVAILABLE / CONNECTION_ERROR | 503 | TIMEOUT | 504 |

`X-Correlation-ID` is accepted (8–64 alphanumeric chars) or generated, returned on every response and
propagated to the gateway.

## Endpoints

| Method & path | Permission | Description |
| ------------- | ---------- | ----------- |
| `GET /health`, `GET /ready` | — | Liveness; readiness (database + gateway) |
| `POST /auth/telegram` `{init_data}` | — | Verify Telegram initData → `{access_token, expires_in, user}` |
| `POST /auth/dev` | — | Development sign-in (only with `ALLOW_DEV_AUTH`, never in production) |
| `GET /me`, `PATCH /me {professional_mode}` | authenticated | Current user, permissions, professional mode |
| `GET /gateway/status` | authenticated | Interface status, VIN on the bus, catalogs, protocol versions |
| `POST /vehicles/connect` | vehicle:connect | Connect, read VIN, register/update the vehicle |
| `POST /vehicles/disconnect` | vehicle:connect | Close the vehicle link |
| `GET /vehicles` | authenticated | The user's vehicles |
| `GET /vehicles/{id}` | owner | Profile, connection, last session, ECU/DTC counts |
| `POST /vehicles/{id}/scan` | diagnostic:scan | Full scan, persisted as a diagnostic session |
| `GET /vehicles/{id}/sessions[/{sid}]` | owner | Scan history / stored session (trace in professional mode) |
| `GET /vehicles/{id}/ecus` | owner | ECUs with capabilities, identification, version history |
| `GET /vehicles/{id}/dtcs?ecu_id&state&system&search&group_by` | owner | DTCs of the latest scan; `state` = any/active/confirmed/pending/history, `group_by` = ecu/system/severity |
| `GET /vehicles/{id}/dtcs/export.csv` | owner | CSV export |
| `GET /vehicles/{id}/dtc-events` | owner | APPEARED / RESOLVED / STATUS_CHANGED / CLEARED timeline |
| `POST /vehicles/{id}/dtcs/clear {ecu_id, confirm}` | dtc:clear | Safety-checked, VIN-verified, audited clear |
| `GET /vehicles/{id}/live-data/parameters` | live_data:read | Discovered parameters with evidence |
| `POST /vehicles/{id}/live-data {parameter_ids[≤64]}` | live_data:read | One reading per parameter |
| `POST /vehicles/{id}/safety {operation, risk}` | owner | Safety decision for an operation |
| `GET /audit?all_users` | authenticated | Own audit entries (all with audit:read_all) |
| `GET /operations` | authenticated | Own diagnostic operation lifecycle records |
| `GET /metrics` | — | Prometheus metrics (restrict at the proxy in production) |

### Full scan response (abridged)

```json
{
  "session_id": "6b0c…", "schema_version": "scan-result/1", "duration_ms": 1162, "probed_addresses": 238,
  "vehicle": { "vin": "SALKA9AE6RA900101", "identity": { "consistent": true, "sources": [ … ] }, "profile": { … } },
  "ecus": [ { "id": "0x7E0", "name": "Powertrain Control Module", "name_source": "ECU_RESPONSE",
              "software_version": "S24.07.2", "capabilities": { "read_dtc": { "status": "SUPPORTED", … }, … } } ],
  "dtcs": [ { "ecu_id": "0x7E0", "display": "P0171-00", "description": "System Too Lean (Bank 1)",
              "description_source": "ISO_STANDARD", "severity": "CHECK_AT_NEXT_HALT", "status": { … } } ],
  "warnings": [],
  "comparison": { "appeared": ["0x7E0 P0171-00"], "resolved": [], "status_changed": [] },
  "trace": null
}
```

## Gateway API (internal)

`X-Gateway-Token` required except `/health`.

| Route | Purpose |
| ----- | ------- |
| `GET /health` | Liveness, interface kind, simulation flag |
| `GET /gw/v1/status` | `InterfaceStatus`, connected VIN, busy operation, catalogs, protocol versions |
| `POST /gw/v1/connect`, `/disconnect`, `/identify`, `/scan` | Vehicle operations |
| `GET /gw/v1/live-data/parameters`, `POST /gw/v1/live-data/read` | Live data |
| `POST /gw/v1/safety/check`, `POST /gw/v1/dtcs/clear` | Safety decision, clear DTCs (requires `expected_vin`, `confirm`, caller permissions) |
| `GET /gw/v1/simulator`, `POST /gw/v1/simulator/profile`, `POST /gw/v1/simulator/faults`, `POST /gw/v1/simulator/faults/reset` | Simulator control (mock interface only) |
| `GET /metrics` | Prometheus metrics |

Fault injection example:

```bash
curl -X POST http://gateway:8100/gw/v1/simulator/faults -H "X-Gateway-Token: $GATEWAY_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"battery_voltage": 11.0, "silent_ecus": ["0x760"], "response_pending": {"0x726": 3}}'
```
