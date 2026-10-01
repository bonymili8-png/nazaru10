"""Simulated ECU: a UDS + OBD-II server answering from a :class:`SimEcuSpec`.

SIMULATION ONLY. Specs describe *simulation profiles*; addresses, DIDs and DTC sets are invented to
exercise the platform and are not statements about real Jaguar Land Rover ECUs.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, field
from typing import TYPE_CHECKING

from jlr_protocols.uds.constants import Nrc, ServiceId, StandardDid
from jlr_simulator.state import VehicleState

if TYPE_CHECKING:
    from jlr_simulator.vehicle import JLRVehicleSimulator

Signal = Callable[[VehicleState], float]

# Linear OBD scaling (physical = raw * scale + offset), mirroring SAE J1979 for the encoder side.
OBD_ENCODING: dict[int, tuple[int, float, float]] = {
    0x04: (1, 100 / 255, 0),
    0x05: (1, 1, -40),
    0x06: (1, 100 / 128, -100),
    0x07: (1, 100 / 128, -100),
    0x0B: (1, 1, 0),
    0x0C: (2, 0.25, 0),
    0x0D: (1, 1, 0),
    0x0E: (1, 0.5, -64),
    0x0F: (1, 1, -40),
    0x10: (2, 0.01, 0),
    0x11: (1, 100 / 255, 0),
    0x1F: (2, 1, 0),
    0x21: (2, 1, 0),
    0x2F: (1, 100 / 255, 0),
    0x31: (2, 1, 0),
    0x33: (1, 1, 0),
    0x42: (2, 0.001, 0),
    0x46: (1, 1, -40),
    0x5C: (1, 1, -40),
}

OBD_SIGNALS: dict[int, Signal] = {
    0x04: lambda s: s.engine_load(),
    0x05: lambda s: s.coolant_temp(),
    0x06: lambda s: 1.6,
    0x07: lambda s: -0.8,
    0x0B: lambda s: 35 + s.engine_load() * 0.6,
    0x0C: lambda s: s.engine_rpm(),
    0x0D: lambda s: s.vehicle_speed(),
    0x0E: lambda s: 12.0,
    0x0F: lambda s: s.intake_air_temp(),
    0x10: lambda s: s.maf(),
    0x11: lambda s: s.throttle(),
    0x1F: lambda s: s.run_time(),
    0x21: lambda s: 0,
    0x2F: lambda s: s.fuel(),
    0x31: lambda s: 1250,
    0x33: lambda s: s.baro(),
    0x46: lambda s: s.ambient_temp(),
    0x5C: lambda s: s.oil_temp(),
}


def encode_linear(value: float, length: int, scale: float, offset: float, *, signed: bool = False) -> bytes:
    raw = round((value - offset) / scale)
    if signed:
        limit = 1 << (8 * length - 1)
        raw = max(-limit, min(limit - 1, raw))
    else:
        raw = max(0, min((1 << (8 * length)) - 1, raw))
    return raw.to_bytes(length, "big", signed=signed)


@dataclass(frozen=True, slots=True)
class SimDid:
    did: int
    name: str
    unit: str
    length: int
    scale: float
    offset: float
    signal: Signal
    signed: bool = False
    min_value: float | None = None
    max_value: float | None = None


@dataclass(slots=True)
class SimDtc:
    dtc: int  # 24-bit
    status: int
    severity: int = 0x40
    snapshot: bytes | None = None  # one identifier: DID (2 bytes) + data
    occurrence: int = 1
    persistent: bool = False  # still failing: returns after a clear
    description: str | None = None  # simulation description for manufacturer-specific codes


@dataclass(slots=True)
class SimEcuSpec:
    key: str
    name: str
    request_id: int
    response_id: int
    part_number: str
    hardware_version: str
    software_version: str
    supplier: str = "SIMSUP"
    serial_number: str = "SIM0000001"
    dtcs: list[SimDtc] = field(default_factory=list)
    obd_pids: set[int] = field(default_factory=set)
    obd_name: str | None = None
    live_dids: list[SimDid] = field(default_factory=list)
    protected_dids: set[int] = field(default_factory=set)
    supports_severity: bool = True
    supports_snapshot: bool = True
    supports_vin: bool = True
    doip_address: int | None = None


def _bitmap(base: int, supported: set[int]) -> bytes:
    bits = 0
    for i in range(32):
        pid = base + i + 1
        if pid in supported or (i == 31 and any(p > base + 0x20 for p in supported)):
            bits |= 1 << (31 - i)
    return bits.to_bytes(4, "big")


def _nrc(service: int, code: Nrc) -> bytes:
    return bytes([0x7F, service, code])


class SimulatedEcu:
    def __init__(self, spec: SimEcuSpec, vehicle: JLRVehicleSimulator) -> None:
        self.spec = spec
        self.vehicle = vehicle
        self.dtcs = [
            SimDtc(d.dtc, d.status, d.severity, d.snapshot, d.occurrence, d.persistent, d.description)
            for d in spec.dtcs
        ]
        self.session = 0x01
        self.requests_handled = 0

    @property
    def state(self) -> VehicleState:
        return self.vehicle.state

    # ------------------------------------------------------------------ dispatch

    def handle(self, request: bytes, *, functional: bool = False) -> bytes | None:
        """Response PDU, or ``None`` when the ECU stays silent."""

        if not request:
            return None
        self.requests_handled += 1
        sid = request[0]
        handlers: dict[int, Callable[[bytes, bool], bytes | None]] = {
            ServiceId.TESTER_PRESENT: self._tester_present,
            ServiceId.DIAGNOSTIC_SESSION_CONTROL: self._session_control,
            ServiceId.READ_DATA_BY_IDENTIFIER: self._read_did,
            ServiceId.READ_DTC_INFORMATION: self._read_dtc,
            ServiceId.CLEAR_DIAGNOSTIC_INFORMATION: self._clear_dtc,
            0x01: self._obd_current_data,
            0x03: self._obd_dtcs,
            0x07: self._obd_dtcs,
            0x09: self._obd_vehicle_info,
        }
        handler = handlers.get(sid)
        if handler is None:
            return None if functional else _nrc(sid, Nrc.SERVICE_NOT_SUPPORTED)
        return handler(request, functional)

    # ------------------------------------------------------------------ UDS

    def _tester_present(self, request: bytes, functional: bool) -> bytes | None:
        if len(request) != 2:
            return _nrc(ServiceId.TESTER_PRESENT, Nrc.INCORRECT_MESSAGE_LENGTH_OR_INVALID_FORMAT)
        if request[1] & 0x80:
            return None
        if request[1] != 0x00:
            return _nrc(ServiceId.TESTER_PRESENT, Nrc.SUB_FUNCTION_NOT_SUPPORTED)
        return bytes([0x7E, 0x00])

    def _session_control(self, request: bytes, functional: bool) -> bytes | None:
        if len(request) != 2:
            return _nrc(ServiceId.DIAGNOSTIC_SESSION_CONTROL, Nrc.INCORRECT_MESSAGE_LENGTH_OR_INVALID_FORMAT)
        session = request[1] & 0x7F
        if session not in (0x01, 0x03):
            return _nrc(ServiceId.DIAGNOSTIC_SESSION_CONTROL, Nrc.SUB_FUNCTION_NOT_SUPPORTED)
        self.session = session
        return bytes([0x50, session, 0x00, 0x32, 0x01, 0xF4])

    def _identification(self) -> dict[int, bytes]:
        s = self.spec
        vin = self.vehicle.faults.vin_override.get(s.request_id, self.vehicle.vin)
        values = {
            StandardDid.SYSTEM_NAME_OR_ENGINE_TYPE: s.name.encode(),
            StandardDid.VEHICLE_MANUFACTURER_SPARE_PART_NUMBER: s.part_number.encode(),
            StandardDid.VEHICLE_MANUFACTURER_ECU_HARDWARE_NUMBER: s.part_number.replace("-", "")[:8].encode(),
            StandardDid.SYSTEM_SUPPLIER_ECU_HARDWARE_VERSION_NUMBER: s.hardware_version.encode(),
            StandardDid.VEHICLE_MANUFACTURER_ECU_SOFTWARE_NUMBER: (s.part_number[:5] + "-SW").encode(),
            StandardDid.SYSTEM_SUPPLIER_ECU_SOFTWARE_VERSION_NUMBER: s.software_version.encode(),
            StandardDid.SYSTEM_SUPPLIER_IDENTIFIER: s.supplier.encode(),
            StandardDid.ECU_SERIAL_NUMBER: s.serial_number.encode(),
        }
        if s.supports_vin:
            values[StandardDid.VIN] = vin.encode()
        return {int(k): v for k, v in values.items()}

    def _read_did(self, request: bytes, functional: bool) -> bytes | None:
        sid = ServiceId.READ_DATA_BY_IDENTIFIER
        if len(request) < 3 or (len(request) - 1) % 2:
            return _nrc(sid, Nrc.INCORRECT_MESSAGE_LENGTH_OR_INVALID_FORMAT)
        identification = self._identification()
        live = {d.did: d for d in self.spec.live_dids}
        body = bytearray([0x62])
        for i in range(1, len(request), 2):
            did = int.from_bytes(request[i : i + 2], "big")
            if did in self.spec.protected_dids:
                return None if functional else _nrc(sid, Nrc.SECURITY_ACCESS_DENIED)
            if did in identification:
                data = identification[did]
            elif did in live:
                d = live[did]
                data = encode_linear(d.signal(self.state), d.length, d.scale, d.offset, signed=d.signed)
            else:
                return None if functional else _nrc(sid, Nrc.REQUEST_OUT_OF_RANGE)
            body += did.to_bytes(2, "big") + data
        return bytes(body)

    def _matching(self, status_mask: int) -> list[SimDtc]:
        return [d for d in self.dtcs if d.status & status_mask]

    def _find(self, dtc: int) -> SimDtc | None:
        return next((d for d in self.dtcs if d.dtc == dtc), None)

    def _read_dtc(self, request: bytes, functional: bool) -> bytes | None:
        sid = ServiceId.READ_DTC_INFORMATION
        if len(request) < 2:
            return _nrc(sid, Nrc.INCORRECT_MESSAGE_LENGTH_OR_INVALID_FORMAT)
        report = request[1]
        if report == 0x01 and len(request) == 3:
            count = len(self._matching(request[2]))
            return bytes([0x59, 0x01, 0xFF, 0x01]) + count.to_bytes(2, "big")
        if report == 0x02 and len(request) == 3:
            body = bytearray([0x59, 0x02, 0xFF])
            for d in self._matching(request[2]):
                body += d.dtc.to_bytes(3, "big") + bytes([d.status])
            return bytes(body)
        if report == 0x04 and len(request) == 6:
            if not self.spec.supports_snapshot:
                return _nrc(sid, Nrc.SUB_FUNCTION_NOT_SUPPORTED)
            found = self._find(int.from_bytes(request[2:5], "big"))
            if found is None:
                return _nrc(sid, Nrc.REQUEST_OUT_OF_RANGE)
            body = bytearray([0x59, 0x04]) + found.dtc.to_bytes(3, "big") + bytes([found.status])
            if found.snapshot and request[5] in (0x01, 0xFF):
                body += bytes([0x01, 0x01]) + found.snapshot
            return bytes(body)
        if report == 0x06 and len(request) == 6:
            found = self._find(int.from_bytes(request[2:5], "big"))
            if found is None:
                return _nrc(sid, Nrc.REQUEST_OUT_OF_RANGE)
            body = bytearray([0x59, 0x06]) + found.dtc.to_bytes(3, "big") + bytes([found.status])
            if request[5] in (0x01, 0xFF):
                body += bytes([0x01, min(found.occurrence, 0xFF)])
            return bytes(body)
        if report == 0x08 and len(request) == 4:
            if not self.spec.supports_severity:
                return _nrc(sid, Nrc.SUB_FUNCTION_NOT_SUPPORTED)
            body = bytearray([0x59, 0x08, 0xFF])
            for d in self._matching(request[3]):
                if d.severity & request[2]:
                    body += bytes([d.severity, 0x00]) + d.dtc.to_bytes(3, "big") + bytes([d.status])
            return bytes(body)
        return _nrc(sid, Nrc.SUB_FUNCTION_NOT_SUPPORTED)

    def _clear_dtc(self, request: bytes, functional: bool) -> bytes | None:
        sid = ServiceId.CLEAR_DIAGNOSTIC_INFORMATION
        if len(request) != 4:
            return _nrc(sid, Nrc.INCORRECT_MESSAGE_LENGTH_OR_INVALID_FORMAT)
        if self.vehicle.faults.ignition_off:
            return _nrc(sid, Nrc.CONDITIONS_NOT_CORRECT)
        if self.state.battery_voltage() < 9.0:
            return _nrc(sid, Nrc.VOLTAGE_TOO_LOW)
        group = int.from_bytes(request[1:4], "big")
        if group != 0xFFFFFF and self._find(group) is None:
            return _nrc(sid, Nrc.REQUEST_OUT_OF_RANGE)
        kept: list[SimDtc] = []
        for d in self.dtcs:
            if group not in (0xFFFFFF, d.dtc):
                kept.append(d)
            elif d.persistent:  # the fault is still present: it is detected again right away
                d.status = 0x01 | 0x02 | 0x04 | 0x20 | 0x40
                d.occurrence = 1
                kept.append(d)
        self.dtcs = kept
        return bytes([0x54])

    # ------------------------------------------------------------------ OBD-II

    def _obd_current_data(self, request: bytes, functional: bool) -> bytes | None:
        if not self.spec.obd_pids or len(request) < 2 or len(request) > 7:
            return None if functional else _nrc(0x01, Nrc.SUB_FUNCTION_NOT_SUPPORTED)
        body = bytearray([0x41])
        voltage = self.state.battery_voltage()
        for pid in request[1:]:
            if pid % 0x20 == 0 and pid <= 0xC0:
                if pid and not any(p > pid for p in self.spec.obd_pids):
                    continue
                body += bytes([pid]) + _bitmap(pid, self.spec.obd_pids)
            elif pid in self.spec.obd_pids and pid in OBD_ENCODING:
                length, scale, offset = OBD_ENCODING[pid]
                value = voltage if pid == 0x42 else OBD_SIGNALS[pid](self.state)
                body += bytes([pid]) + encode_linear(value, length, scale, offset)
        if len(body) == 1:
            return None if functional else _nrc(0x01, Nrc.REQUEST_OUT_OF_RANGE)
        return bytes(body)

    def _obd_dtcs(self, request: bytes, functional: bool) -> bytes | None:
        if not self.spec.obd_pids:
            return None if functional else _nrc(request[0], Nrc.SERVICE_NOT_SUPPORTED)
        mask = 0x08 if request[0] == 0x03 else 0x04
        codes = [d.dtc >> 8 for d in self.dtcs if d.status & mask and (d.dtc >> 22) == 0]  # P-codes only
        body = bytearray([request[0] + 0x40, len(codes)])
        for code in codes:
            body += code.to_bytes(2, "big")
        return bytes(body)

    def _obd_vehicle_info(self, request: bytes, functional: bool) -> bytes | None:
        if not self.spec.obd_pids or len(request) != 2:
            return None if functional else _nrc(0x09, Nrc.SUB_FUNCTION_NOT_SUPPORTED)
        info = request[1]
        if info == 0x00:
            return bytes([0x49, 0x00]) + _bitmap(0x00, {0x02, 0x0A})
        if info == 0x02:
            vin = self.vehicle.faults.vin_override.get(self.spec.request_id, self.vehicle.vin)
            return bytes([0x49, 0x02, 0x01]) + vin.encode()
        if info == 0x0A and self.spec.obd_name:
            return bytes([0x49, 0x0A, 0x01]) + self.spec.obd_name.encode().ljust(20, b"\x00")[:20]
        return None if functional else _nrc(0x09, Nrc.REQUEST_OUT_OF_RANGE)
