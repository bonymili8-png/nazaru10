# Hardware

The application never depends on a specific adapter: everything goes through `DiagnosticInterface`
(`connect`, `disconnect`, `send(address, payload)`, `read(address, timeout)`, `status`,
`functional_request`, `candidate_addresses`, `passive_listen`). Choose the implementation with
`GATEWAY_INTERFACE`.

| Interface | Class | Status |
| --------- | ----- | ------ |
| `mock` | `MockInterface` = `CANInterface` over the simulator bus | Complete; used by all tests and the default stack |
| `socketcan` | `SocketCANInterface` = `CANInterface` over `SocketCanBus` (stdlib `AF_CAN`, classic + FD) | Implemented; frame packing unit-tested; **not validated on a vehicle** |
| `doip` | `DoIPInterface` over `DoIPClient` (TCP 13400) | Implemented; tested against the simulated DoIP entity; **not validated on a vehicle** |
| `j2534` | `J2534Interface` | **Not implemented** — explicit limitation, `connect()` raises `UNSUPPORTED_OPERATION` |
| any CAN bus | `CANInterface(bus)` | Any `CanBus` implementation (e.g. a future USB-serial adapter driver) |

Voltage: the mock interface reports the simulated battery voltage. SocketCAN exposes none, so the
service falls back to OBD-II PID 0x42 (control-module voltage) when an ECU supports it; otherwise
voltage is `UNAVAILABLE` and configuration/flashing are blocked by the safety checker.

## SocketCAN bench setup (Linux)

```bash
sudo ip link set can0 type can bitrate 500000            # classic CAN
sudo ip link set can0 type can bitrate 500000 dbitrate 2000000 fd on   # CAN-FD
sudo ip link set can0 up
GATEWAY_INTERFACE=socketcan GATEWAY_SOCKETCAN_CHANNEL=can0 GATEWAY_TOKEN=… uv run python -m jlr_gateway
```

The gateway container needs host networking (`network_mode: host`) to see `can0`. A virtual bus for
experiments: `sudo modprobe vcan && sudo ip link add vcan0 type vcan && sudo ip link set vcan0 up`.

## DoIP

```bash
GATEWAY_INTERFACE=doip GATEWAY_DOIP_HOST=<entity ip> GATEWAY_DOIP_TARGETS=0x1010,0x1011 …
```

If the entity requires authenticated routing activation or TLS, the connection fails with
`SECURITY_ACCESS_REQUIRED` (`OEM_AUTH_REQUIRED`) — by design.

## Before connecting to a real vehicle

* Use a battery support unit for anything longer than a quick read; never write with a weak battery.
* Bench-test on a module or a vehicle you can afford to recover before using a new adapter.
* Start with read-only operations. Milestone 1 can only *clear DTCs*; no coding, adaptation or
  flashing exists.
* Discovery transmits TesterPresent on candidate identifiers. Check the address plan for the vehicle
  family first, keep the passive-listen step enabled, and keep concurrency low (default 4).
* Some recent vehicles restrict diagnostic access through a gateway module. The platform will report
  what the vehicle refuses (`OEM_AUTH_REQUIRED`) and will not attempt to circumvent it.
