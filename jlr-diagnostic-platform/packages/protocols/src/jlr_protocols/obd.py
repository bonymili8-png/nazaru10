"""OBD-II on CAN (SAE J1979 / ISO 15031-5, ISO 15765-4).

Only legislated, publicly standardised content lives here: service IDs, the Mode 01 PIDs with
their SAE scaling, supported-PID bitmaps, Mode 03/07/0A DTC lists and Mode 09 vehicle information.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from enum import IntEnum

from jlr_protocols.uds.codec import check_response
from jlr_shared_types.errors import ProtocolError

OBD_FUNCTIONAL_REQUEST_ID = 0x7DF
OBD_PHYSICAL_REQUEST_IDS = tuple(range(0x7E0, 0x7E8))
OBD_RESPONSE_IDS = tuple(range(0x7E8, 0x7F0))
SUPPORTED_PID_RANGES = (0x00, 0x20, 0x40, 0x60, 0x80, 0xA0, 0xC0)


class ObdMode(IntEnum):
    CURRENT_DATA = 0x01
    FREEZE_FRAME = 0x02
    STORED_DTCS = 0x03
    CLEAR_DTCS = 0x04
    PENDING_DTCS = 0x07
    VEHICLE_INFORMATION = 0x09
    PERMANENT_DTCS = 0x0A


@dataclass(frozen=True, slots=True)
class PidDefinition:
    pid: int
    name: str
    unit: str
    length: int
    decode: Callable[[bytes], float]
    min_value: float | None = None
    max_value: float | None = None


def _a(data: bytes) -> int:
    return data[0]


def _ab(data: bytes) -> int:
    return (data[0] << 8) | data[1]


PIDS: dict[int, PidDefinition] = {
    p.pid: p
    for p in (
        PidDefinition(0x04, "Calculated engine load", "%", 1, lambda d: _a(d) * 100 / 255, 0, 100),
        PidDefinition(0x05, "Engine coolant temperature", "°C", 1, lambda d: _a(d) - 40, -40, 215),
        PidDefinition(
            0x06, "Short term fuel trim — bank 1", "%", 1, lambda d: (_a(d) - 128) * 100 / 128, -100, 99.2
        ),
        PidDefinition(
            0x07, "Long term fuel trim — bank 1", "%", 1, lambda d: (_a(d) - 128) * 100 / 128, -100, 99.2
        ),
        PidDefinition(0x0B, "Intake manifold absolute pressure", "kPa", 1, lambda d: float(_a(d)), 0, 255),
        PidDefinition(0x0C, "Engine speed", "rpm", 2, lambda d: _ab(d) / 4, 0, 16383.75),
        PidDefinition(0x0D, "Vehicle speed", "km/h", 1, lambda d: float(_a(d)), 0, 255),
        PidDefinition(0x0E, "Timing advance", "°", 1, lambda d: _a(d) / 2 - 64, -64, 63.5),
        PidDefinition(0x0F, "Intake air temperature", "°C", 1, lambda d: _a(d) - 40, -40, 215),
        PidDefinition(0x10, "Mass air flow rate", "g/s", 2, lambda d: _ab(d) / 100, 0, 655.35),
        PidDefinition(0x11, "Throttle position", "%", 1, lambda d: _a(d) * 100 / 255, 0, 100),
        PidDefinition(0x1F, "Run time since engine start", "s", 2, lambda d: float(_ab(d)), 0, 65535),
        PidDefinition(0x21, "Distance travelled with MIL on", "km", 2, lambda d: float(_ab(d)), 0, 65535),
        PidDefinition(0x2F, "Fuel tank level input", "%", 1, lambda d: _a(d) * 100 / 255, 0, 100),
        PidDefinition(
            0x31, "Distance travelled since codes cleared", "km", 2, lambda d: float(_ab(d)), 0, 65535
        ),
        PidDefinition(0x33, "Absolute barometric pressure", "kPa", 1, lambda d: float(_a(d)), 0, 255),
        PidDefinition(0x42, "Control module voltage", "V", 2, lambda d: _ab(d) / 1000, 0, 65.535),
        PidDefinition(0x46, "Ambient air temperature", "°C", 1, lambda d: _a(d) - 40, -40, 215),
        PidDefinition(0x5C, "Engine oil temperature", "°C", 1, lambda d: _a(d) - 40, -40, 210),
    )
}


def build_request(mode: ObdMode | int, *pids: int) -> bytes:
    if len(pids) > 6:
        raise ProtocolError("An OBD request carries at most 6 PIDs")
    return bytes([int(mode), *pids])


def parse_supported_pids(base: int, data: bytes) -> set[int]:
    """Decode a 4-byte supported-PID bitmap for PIDs ``base+1 .. base+0x20``."""

    if len(data) != 4:
        raise ProtocolError("Supported-PID bitmap must be 4 bytes")
    bits = int.from_bytes(data, "big")
    return {base + i + 1 for i in range(32) if bits & (1 << (31 - i))}


def parse_mode01_response(response: bytes, requested: list[int]) -> dict[int, bytes]:
    """Split a (possibly multi-PID) Mode 01 response into ``{pid: data}``.

    Supported-PID bitmaps (0x00, 0x20, ...) are 4 bytes; other PIDs must be known in :data:`PIDS`
    so their lengths are known.
    """

    check_response(ObdMode.CURRENT_DATA, response)
    result: dict[int, bytes] = {}
    offset = 1
    while offset < len(response):
        pid = response[offset]
        if pid not in requested:
            raise ProtocolError(f"Mode 01 response carries unrequested PID 0x{pid:02X}")
        length = 4 if pid in SUPPORTED_PID_RANGES else (PIDS[pid].length if pid in PIDS else None)
        if length is None:
            raise ProtocolError(f"Cannot split response: length of PID 0x{pid:02X} unknown")
        data = response[offset + 1 : offset + 1 + length]
        if len(data) != length:
            raise ProtocolError(f"Truncated data for PID 0x{pid:02X}")
        result[pid] = data
        offset += 1 + length
    return result


def parse_dtc_list(mode: ObdMode | int, response: bytes) -> list[int]:
    """Mode 03/07/0A on CAN: ``SID+0x40, count, (2-byte DTC)*count``."""

    check_response(int(mode), response)
    if len(response) < 2:
        raise ProtocolError("Truncated OBD DTC response")
    count = response[1]
    body = response[2:]
    if len(body) < count * 2:
        raise ProtocolError("OBD DTC response shorter than its count")
    return [(body[i] << 8) | body[i + 1] for i in range(0, count * 2, 2)]


def parse_vehicle_information(response: bytes, info_type: int) -> bytes:
    """Mode 09 on CAN: ``0x49, InfoType, NumberOfDataItems, data``."""

    check_response(ObdMode.VEHICLE_INFORMATION, response)
    if len(response) < 3 or response[1] != info_type:
        raise ProtocolError(f"Unexpected Mode 09 response for InfoType 0x{info_type:02X}")
    return response[3:]


def parse_vin(response: bytes) -> str:
    data = parse_vehicle_information(response, 0x02).rstrip(b"\x00")
    try:
        vin = data.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise ProtocolError("VIN is not ASCII") from exc
    if len(vin) != 17:
        raise ProtocolError(f"VIN must be 17 characters, got {len(vin)}")
    return vin


def parse_ecu_name(response: bytes) -> str:
    data = parse_vehicle_information(response, 0x0A)
    return data.replace(b"\x00", b"").decode("ascii", errors="replace").strip()
