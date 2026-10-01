# Protocols

All protocol code is in `packages/protocols` (pure codecs + async clients) and has no knowledge of
the application. Versions in use are exposed by the gateway (`GET /gw/v1/status → protocols`).

## CAN / CAN-FD (`jlr_protocols.can`)

`CanFrame` validates 11/29-bit identifiers and classic (≤ 8) or CAN-FD (0–8, 12, 16, 20, 24, 32, 48,
64) lengths. `CanBus` is the raw bus protocol (simulated bus, SocketCAN). `CanFrameRouter` is the
single reader of a bus and routes frames to per-identifier subscriptions; a bus failure is pushed to
every waiter so nothing hangs.

## ISO-TP — ISO 15765-2 (`jlr_protocols.isotp`)

* Single, first, consecutive and flow-control frames; normal addressing.
* Classic CAN (TX_DL 8) and CAN-FD (TX_DL 12–64) including the CAN-FD single-frame escape and 32-bit
  first-frame lengths (> 4095 bytes).
* Flow control: block size, STmin (ms and 100–900 µs ranges; reserved values → 127 ms), WAIT (bounded),
  OVERFLOW; N_Bs and N_Cr timeouts; sequence-number checking; padding configurable (default 0xCC).
* The same `IsoTpChannel` serves testers and simulated ECUs.

## UDS — ISO 14229-1 (`jlr_protocols.uds`)

Codec builders/parsers and `UdsClient` methods for:

| SID  | Service                        | Gated by permission         |
| ---- | ------------------------------ | --------------------------- |
| 0x10 | DiagnosticSessionControl       | programming session only (`uds:transfer`) |
| 0x11 | ECUReset                       | `uds:ecu_reset`             |
| 0x14 | ClearDiagnosticInformation     | `dtc:clear`                 |
| 0x19 | ReadDTCInformation (01, 02, 04, 06, 08, 0A parsers) | — |
| 0x22 | ReadDataByIdentifier           | —                           |
| 0x23 | ReadMemoryByAddress            | `uds:memory_read`           |
| 0x27 | SecurityAccess (request seed / send key) | `uds:security_access` |
| 0x28 | CommunicationControl           | `uds:communication_control` |
| 0x2E | WriteDataByIdentifier          | `uds:write_data`            |
| 0x31 | RoutineControl                 | `uds:routine_control`       |
| 0x34/0x35/0x36/0x37 | RequestDownload/Upload, TransferData, RequestTransferExit | `uds:transfer` |
| 0x3E | TesterPresent (incl. suppressed response) | —                |

The client handles P2/P2* timing, `0x78 responsePending` (bounded), late responses to earlier
requests (skipped) and suppressed positive responses. Negative responses become
`NegativeResponseError(service_id, nrc, nrc_name)`. Only ISO-defined identifiers are constants
(`StandardDid` 0xF180–0xF19E); manufacturer identifiers come from catalogs.

DTCs are 24-bit; display is ISO 15031-6 style `P0300-1C` (code + SAE J2012 failure-type byte, with
the standard failure-type descriptions).

## OBD-II — SAE J1979 on ISO 15765-4 (`jlr_protocols.obd`)

Functional requests on 0x7DF, responses on 0x7E8–0x7EF. Implemented: Mode 01 (supported-PID bitmap
walk, multi-PID requests ≤ 6, SAE scaling for 19 common PIDs incl. 0x42 control-module voltage),
Mode 03/07/0A DTC lists, Mode 09 PID 02 (VIN) and 0A (ECU name).

## DoIP — ISO 13400-2 (`jlr_protocols.doip`)

Generic header (version/inverse validation, length limit), routing activation (authentication-required
codes → `SecurityAccessRequiredError`, never bypassed), diagnostic message + ACK/NACK, alive check,
vehicle announcement parser. `DoIPClient` keeps one TCP connection; ACK handling is serialised. Not
implemented: UDP discovery, TLS (port 3496), entity status/power mode requests.

## ECU discovery

1. **Passive listen** (`GATEWAY_PASSIVE_LISTEN`, default 0.2 s): any identifier seen on the bus is
   excluded from probing — the tester never transmits on an identifier another node uses.
2. **Candidate plan** (`CanAddressPlan`): request IDs `GATEWAY_ADDRESS_RANGE_START..END` (default
   0x700–0x7F7) with response = request + `GATEWAY_RESPONSE_OFFSET` (default 8). This is a widespread
   convention, **not** a guarantee; it is configurable.
3. **Probe**: TesterPresent with a short P2 (`GATEWAY_PROBE_TIMEOUT`), ascending, at most
   `GATEWAY_DISCOVERY_CONCURRENCY` (≤ 8) in flight. Positive *or negative* response = ECU present;
   malformed response = present with a warning; silence = absent.
4. The response ID of every found ECU is excluded from later probes.
5. DoIP: the entity's logical address plus `GATEWAY_DOIP_TARGETS` (ISO 13400 has no ECU enumeration).

## Capability classification

| Observation                                    | Status                         |
| ---------------------------------------------- | ------------------------------ |
| Positive response                              | SUPPORTED                      |
| NRC 0x11, 0x12, 0x31                           | NOT_SUPPORTED                  |
| NRC 0x7E, 0x7F (not in active session)         | SUPPORTED_WITH_PREREQUISITES (session) |
| NRC 0x21, 0x22, 0x24, 0x92, 0x93               | SUPPORTED_WITH_PREREQUISITES (conditions) |
| NRC 0x33, 0x34; DoIP activation needs auth     | OEM_AUTH_REQUIRED              |
| Timeout, malformed, other NRC                  | UNKNOWN                        |
| Not probed (all mutating capabilities)         | UNKNOWN                        |

`HARDWARE_REQUIRED` is reserved for definitions that state a hardware dependency (Milestone 3).

## Definition catalogs

Catalogs map identifiers to meaning and always carry their evidence source. Operator-verified catalogs
are JSON files in `GATEWAY_CATALOG_DIR`:

```json
{
  "name": "Workshop verified — Example",
  "version": "2026-09",
  "dtc_descriptions": { "P1234": "Verified description" },
  "did_parameters": {
    "0x7E0": [{ "did": "0x1234", "name": "Example sensor", "unit": "V", "length": 2, "scale": 0.01, "offset": 0, "signed": false }]
  },
  "occurrence_records": { "0x7E0": { "record_number": 1, "length": 1 } }
}
```

Rules: definitions are per ECU request address (never global); the SAE generic table is never used for
manufacturer-specific code ranges (P1xxx, P30–P33xx, B/C/U 1xxx–2xxx); a DID is offered as live data
only after the ECU answered a test read.
