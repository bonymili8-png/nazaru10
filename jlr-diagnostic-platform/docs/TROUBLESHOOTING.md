# Troubleshooting

| Symptom | Cause / fix |
| ------- | ----------- |
| Mini App says "Open this app from Telegram to sign in" | No Telegram `initData` and the build has `VITE_DEV_AUTH=false`. For local use rebuild with `VITE_DEV_AUTH=true` (compose default) and keep `ALLOW_DEV_AUTH=true` on the API. |
| `AUTH_REQUIRED: Telegram initData signature is invalid` | `TELEGRAM_BOT_TOKEN` does not belong to the bot that opened the Mini App. |
| `AUTH_REQUIRED: Telegram initData has expired` | The Mini App stayed open longer than `INIT_DATA_MAX_AGE_SECONDS`; reopen it. |
| API exits with `ALLOW_DEV_AUTH must be false in production` | Intended start-up guard; fix the environment. |
| `GATEWAY_UNAVAILABLE` | Gateway not running/reachable from the API, or token mismatch (`GATEWAY_TOKEN` must be identical on both). Check `GET /api/v1/ready`. |
| `NOT_CONNECTED` | Press *Connect* first; after an adapter disconnect, reconnect. |
| `VIN_MISMATCH` | The gateway is connected to another vehicle than the one selected (or the vehicle changed since the scan). Select the right vehicle or reconnect. |
| `OPERATION_IN_PROGRESS` | Another operation (scan, clear) holds the bus. Wait and retry; live data pauses during a scan. |
| `LOW_VOLTAGE` / `SAFETY_BLOCKED` | The safety checker blocked a mutation. Connect a battery support unit, switch the ignition on, check the connection. Reasons are in `error.details.safety.reasons`. |
| Scan finds no ECUs | Ignition off, wrong bitrate/channel, or the vehicle uses another address plan. Adjust `GATEWAY_ADDRESS_RANGE_*`, `GATEWAY_RESPONSE_OFFSET`, `GATEWAY_PROBE_TIMEOUT`. Check `warnings` for skipped in-use identifiers. |
| Capabilities show `UNKNOWN` | Expected when there is no evidence (e.g. write capabilities are never probed). See [PROTOCOLS.md](PROTOCOLS.md#capability-classification). |
| DTC has "No verified description" | Manufacturer-specific code without a verified catalog entry. Add an operator-verified catalog (`GATEWAY_CATALOG_DIR`). |
| `SECURITY_ACCESS_REQUIRED` | The ECU or DoIP entity requires OEM authentication. The platform does not bypass it. |
| `UNSUPPORTED_OPERATION` with `j2534` | J2534 is not implemented in Milestone 1. |
| SocketCAN: `Cannot bind SocketCAN channel` | Interface down or container without host networking: `ip link set can0 up`, run the gateway with `network_mode: host`. |
| `docker compose build` fails with certificate errors | You are behind a TLS-intercepting proxy: `EXTRA_CA_CERT=/path/ca.pem docker compose build`. |
| `RATE_LIMITED` | Per-user limits (scan 6/min, mutations 10/min, live 240/min). `details.retry_after_seconds` says when to retry. |

Every error response carries a `correlation_id`; search the API and gateway logs for it to follow the
operation across services.
