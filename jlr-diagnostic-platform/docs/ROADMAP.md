# Roadmap

Real Land Rover / Range Rover support is **not** complete because the simulator works. Each item
below lists what makes it done.

## Milestone 1 — simulation-first vertical slice ✅

Mock vehicle → mock diagnostic interface → ISO-TP → UDS → ECU discovery → VIN → DTC → live data →
gateway → REST API → Telegram Mini App, `docker compose up`, automated tests.

Delivered: protocol stack (CAN/CAN-FD, ISO-TP, UDS client with 14 services, OBD-II, DoIP), capability
model, discovery, DTC engine (read/filter/group/compare/export/clear), live data, safety checker,
access guard, simulator with 6 profiles and fault injection, gateway, API with persistence and audit,
Mini App (Dashboard, Vehicles, Vehicle details, Full scan, ECUs, DTC, Live data, History, Logs,
Settings), Docker, CI.

### Known limitations

* No validation against a real vehicle. SocketCAN/DoIP paths are tested only against the simulator.
* Candidate CAN addresses use the configurable 0x700–0x7F7 / +8 heuristic; vehicles using other
  schemes (29-bit, other offsets) need a configured address plan.
* Freeze frames with several identifiers are shown raw (no ECU data definitions).
* No JLR-specific DTC descriptions, DIDs or routines: only SAE generic content, simulator content and
  operator-verified catalogs.
* One gateway per API deployment; the API must reach the gateway over a secured network.
* Rate limiting is in-process (single API instance).
* Recorded live data is exported client-side; samples are not stored server-side.

## Milestone 2 — configuration engine

* `ConfigurationParameter` model and catalog format (id, ECU, allowed/default values, source,
  confidence, risk, dependencies, capability status).
* `BackupManager` (immutable, checksummed, VIN/ECU/HW/SW-bound) and `RestoreOperation` with
  compatibility validation.
* Transaction engine `PRECHECK → BACKUP → WRITE → VERIFY → COMMIT`, rollback when possible.
* DB tables: ConfigurationParameter, ConfigurationSnapshot, Backup, RestoreOperation.
* Mini App: Configuration and Backups screens with the critical-operation confirmation sheet.
* Done when: simulator ECUs support coding DIDs and every failure path (power loss, verify mismatch,
  incompatible SW) is tested.

## Milestone 3 — real hardware & discovery depth

* Bench validation of SocketCAN (classic + FD) and DoIP (vehicle announcement, entity status,
  TLS / ISO 13400-2:2019 where required).
* J2534 PassThru via vendor libraries (ctypes), validated on at least one adapter.
* Address-plan profiles per platform, sourced from verified data.
* Feature discovery engine (exposed / configured / supported / hardware absent / software absent /
  OEM restricted / unknown, with evidence).
* Service functions (routines) with prerequisites and safety checks.

## Milestone 4 — AI-assisted diagnostics

* Inputs: DTCs, freeze frames, live data, profile, ECU data, history.
* Output strictly separated into FACT / INFERENCE / HYPOTHESIS with confidence, recommended tests and
  required measurements. No diagnosis without evidence.

## Milestone 5 — production hardening

* Redis-backed rate limiting, multiple API instances, gateway registration (outbound tunnel from the
  gateway, per-gateway credentials, gateway ↔ user binding).
* Error tracking integration (hook exists), dashboards for the Prometheus metrics.
* Data retention policies for traces and history.
