# Testing

```bash
uv run pytest                                  # all Python tests (SQLite for API tests)
TEST_DATABASE_URL=postgresql+asyncpg://jlr:jlr@localhost:5432/jlr_test uv run pytest   # API tests on PostgreSQL
uv run pytest --cov                            # with coverage (≈ 87 % lines)
cd apps/telegram-mini-app && npm test          # Mini App (vitest + Testing Library)
scripts/smoke.sh http://localhost:8080         # end-to-end against a running stack
```

With `TEST_DATABASE_URL`, run migrations on that database first (`scripts/check.sh` does it); the
PostgreSQL-only test then proves the audit log rejects `UPDATE`/`DELETE`.

## Layout

| Directory | Scope |
| --------- | ----- |
| `tests/protocol` | ISO-TP (segmentation, FD, 32-bit lengths, STmin, WAIT/OVERFLOW, N_Bs/N_Cr timeouts), UDS codec & client (pending, stale, suppress, NRC), OBD-II, CAN/SocketCAN packing, DoIP codec |
| `tests/unit` | VIN & profile, capability classification, safety verdicts, catalogs, DTC engine (filter/group/compare/CSV), access guard, security access policy, Telegram initData, JWT, rate limiter |
| `tests/integration` | DiagnosticService → protocol stack → simulator: connect, full scan, DTC enrichment, live data, every simulation profile, CAN-FD, DoIP, authenticated DoIP activation |
| `tests/simulation` | Failure handling (below) |
| `tests/api` | Every gateway and public API endpoint, wired in-process: API → gateway app → simulator |
| `apps/telegram-mini-app/src/test` | Sign-in, connect, scan, DTC clear confirmation (allowed and blocked), live streaming, CSV |

No test mocks the protocol stack: integration and API tests run real ISO-TP and UDS against the
simulated ECUs.

## Failure scenarios

| Scenario | Test |
| -------- | ---- |
| Timeout / ECU unavailable | `test_silent_ecu_is_absent_not_invented`, `test_live_data_timeout_reported_per_parameter` |
| Slow ECU (responsePending) | `test_slow_ecu_with_response_pending_still_scanned` |
| Disconnect (adapter unplugged) + recovery | `test_adapter_disconnect_fails_fast_and_recovers` |
| Invalid response | `test_corrupt_responses_degrade_to_warnings`, ISO-TP/UDS malformed-frame tests |
| Low voltage | `test_clear_dtc_blocked_by_low_voltage`, `test_low_voltage_blocks_clear_through_api` |
| Ignition off | `test_clear_dtc_blocked_with_ignition_off` |
| Wrong VIN | `test_clear_dtc_wrong_vin_and_wrong_ecu`, `test_vehicle_swap_after_scan_is_detected`, `test_gateway_on_other_vehicle_is_rejected`, `test_module_with_foreign_vin_is_flagged` |
| Wrong ECU | `test_clear_dtc_wrong_vin_and_wrong_ecu`, `test_unknown_live_parameter_rejected` |
| Interrupted operation | `test_interrupted_multiframe_transfer`, `test_interrupted_transfer_times_out` |
| Concurrent operation | `test_concurrent_scan_rejected` |
| Unsupported hardware | `test_j2534_is_an_explicit_limitation`, `test_doip_authenticated_activation_is_reported_not_bypassed` |
| Permissions | `test_viewer_cannot_operate`, `test_guard_blocks_sensitive_services`, `test_security_access_never_retries` |
| Gateway down | `test_gateway_unreachable_is_structured` |

Incompatible configuration (backup/restore compatibility) is tested with the configuration engine in
Milestone 2.

## Simulator fault injection

`JLRVehicleSimulator.faults` (or `POST /gw/v1/simulator/faults`): `disconnected`, `battery_voltage`,
`ignition_off`, `silent_ecus`, `corrupt_ecus`, `response_pending`, `response_delay`,
`interrupt_multiframe`, `vin_override`.
