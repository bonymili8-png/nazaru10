"""SIMULATION PROFILES.

These profiles exist to exercise the platform end to end. ECU names, CAN identifiers, part numbers,
DIDs (0x4xxx), DTC sets and model facts are invented for simulation and are NOT statements about the
architecture of real Range Rover, Range Rover Sport, Defender, Discovery, Discovery Sport or Evoque
vehicles. Every fact a profile contributes is tagged ``EvidenceSource.SIMULATION``.

VINs are syntactically valid (ISO 3779, correct check digit, the registered Land Rover WMI "SAL")
and use serial numbers in the 9xxxxx range reserved here for simulation.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from jlr_protocols.uds import parse_dtc_code
from jlr_simulator.ecu import Signal, SimDid, SimDtc, SimEcuSpec
from jlr_vehicle_model import with_check_digit

OBD_ENGINE_PIDS = {
    0x04,
    0x05,
    0x06,
    0x07,
    0x0B,
    0x0C,
    0x0D,
    0x0E,
    0x0F,
    0x10,
    0x11,
    0x1F,
    0x21,
    0x2F,
    0x31,
    0x33,
    0x42,
    0x46,
    0x5C,
}
OBD_TRANSMISSION_PIDS = {0x0C, 0x0D, 0x42}

# Status bytes used below (ISO 14229-1 D.2)
ACTIVE_MIL = 0xAF  # testFailed, thisCycle, pending, confirmed, failedSinceClear, warningIndicator
ACTIVE = 0x2F  # as above without warning indicator
PENDING = 0x24  # pending, failedSinceClear
HISTORY = 0x28  # confirmed, failedSinceClear (not failing now)

SEV_IMMEDIATE = 0x80
SEV_NEXT_HALT = 0x40
SEV_MAINTENANCE = 0x20


def dtc(code: str, failure_type: int = 0x00) -> int:
    return (parse_dtc_code(code) << 8) | failure_type


def _did(
    did: int, name: str, unit: str, length: int, scale: float, offset: float, signal: Signal, **kw: Any
) -> SimDid:
    return SimDid(did, name, unit, length, scale, offset, signal, **kw)


@dataclass(frozen=True, slots=True)
class SimulationProfile:
    key: str
    title: str
    vin: str
    facts: dict[str, str]
    ecus: tuple[SimEcuSpec, ...] = field(default_factory=tuple)


def _pcm(*dtcs: SimDtc, engine: str = "PCM") -> SimEcuSpec:
    return SimEcuSpec(
        key="pcm",
        name="Powertrain Control Module",
        request_id=0x7E0,
        response_id=0x7E8,
        part_number=f"SIM-{engine}-14C204-AB",
        hardware_version="H3.1",
        software_version="S24.07.2",
        supplier="SIMBOS",
        serial_number="SIMP100231",
        dtcs=list(dtcs),
        obd_pids=set(OBD_ENGINE_PIDS),
        obd_name="ECM-EngineControl",
        live_dids=[
            _did(
                0x4010,
                "Fuel rail pressure (sim)",
                "kPa",
                2,
                1.0,
                0.0,
                lambda s: 38000 + s.engine_load() * 200,
            ),
            _did(
                0x4011,
                "Turbo boost pressure (sim)",
                "kPa",
                2,
                0.1,
                0.0,
                lambda s: 100 + s.engine_load() * 1.2,
            ),
        ],
        doip_address=0x1010,
    )


def _tcm(*dtcs: SimDtc) -> SimEcuSpec:
    return SimEcuSpec(
        key="tcm",
        name="Transmission Control Module",
        request_id=0x7E1,
        response_id=0x7E9,
        part_number="SIM-TCM-7J104-CD",
        hardware_version="H2.0",
        software_version="S23.11.0",
        supplier="SIMZF",
        serial_number="SIMT200118",
        dtcs=list(dtcs),
        obd_pids=set(OBD_TRANSMISSION_PIDS),
        obd_name="TCM-TransmissionCtl",
        live_dids=[
            _did(
                0x4101,
                "Transmission fluid temperature (sim)",
                "°C",
                1,
                1.0,
                -40.0,
                lambda s: s.transmission_temp(),
            ),
            _did(
                0x4102,
                "Selected gear (sim)",
                "",
                1,
                1.0,
                0.0,
                lambda s: 0 if s.vehicle_speed() < 1 else min(8, 1 + int(s.vehicle_speed() // 12)),
            ),
        ],
        doip_address=0x1011,
    )


def _abs(*dtcs: SimDtc) -> SimEcuSpec:
    return SimEcuSpec(
        key="abs",
        name="Anti-lock Brake / Stability Control",
        request_id=0x760,
        response_id=0x768,
        part_number="SIM-ABS-2C405-EF",
        hardware_version="H1.4",
        software_version="S22.03.5",
        serial_number="SIMA300077",
        dtcs=list(dtcs),
        live_dids=[
            _did(0x4501, "Average wheel speed (sim)", "km/h", 2, 0.01, 0.0, lambda s: s.vehicle_speed())
        ],
        doip_address=0x1020,
    )


def _bcm(*dtcs: SimDtc) -> SimEcuSpec:
    return SimEcuSpec(
        key="bcm",
        name="Body Control Module",
        request_id=0x726,
        response_id=0x72E,
        part_number="SIM-BCM-15K600-GH",
        hardware_version="H5.0",
        software_version="S25.01.1",
        serial_number="SIMB400310",
        dtcs=list(dtcs),
        live_dids=[
            _did(0x4201, "Battery voltage (BCM, sim)", "V", 2, 0.001, 0.0, lambda s: s.battery_voltage()),
            _did(0x4202, "Cabin temperature (sim)", "°C", 2, 0.1, 0.0, lambda s: s.cabin_temp(), signed=True),
        ],
        doip_address=0x1040,
    )


def _ipc(*dtcs: SimDtc) -> SimEcuSpec:
    return SimEcuSpec(
        key="ipc",
        name="Instrument Cluster",
        request_id=0x720,
        response_id=0x728,
        part_number="SIM-IPC-10849-JK",
        hardware_version="H2.2",
        software_version="S24.02.0",
        serial_number="SIMI500021",
        dtcs=list(dtcs),
        live_dids=[
            _did(0x4301, "Odometer (sim)", "km", 3, 0.1, 0.0, lambda s: s.odometer()),
            _did(0x4302, "Fuel gauge level (sim)", "%", 1, 0.5, 0.0, lambda s: s.fuel()),
        ],
        supports_severity=False,
        doip_address=0x1050,
    )


def _gwm(*dtcs: SimDtc) -> SimEcuSpec:
    return SimEcuSpec(
        key="gwm",
        name="Gateway Module",
        request_id=0x716,
        response_id=0x71E,
        part_number="SIM-GWM-14F642-LM",
        hardware_version="H1.0",
        software_version="S25.03.4",
        serial_number="SIMG600005",
        dtcs=list(dtcs),
        protected_dids={0xF18C},  # demonstrates OEM_AUTH_REQUIRED reporting
        doip_address=0x1001,
    )


def _rcm(*dtcs: SimDtc) -> SimEcuSpec:
    return SimEcuSpec(
        key="rcm",
        name="Restraints Control Module",
        request_id=0x737,
        response_id=0x73F,
        part_number="SIM-RCM-14B321-NP",
        hardware_version="H3.0",
        software_version="S21.09.0",
        serial_number="SIMR700042",
        dtcs=list(dtcs),
        supports_snapshot=False,
        doip_address=0x1060,
    )


def _ascm(*dtcs: SimDtc) -> SimEcuSpec:
    return SimEcuSpec(
        key="ascm",
        name="Air Suspension Control Module",
        request_id=0x7A6,
        response_id=0x7AE,
        part_number="SIM-ASCM-3C097-QR",
        hardware_version="H2.1",
        software_version="S24.05.3",
        serial_number="SIMS800090",
        dtcs=list(dtcs),
        live_dids=[
            _did(
                0x4401,
                "Front ride height deviation (sim)",
                "mm",
                2,
                0.1,
                0.0,
                lambda s: s.ride_height_front(),
                signed=True,
            ),
            _did(
                0x4402, "Air reservoir pressure (sim)", "bar", 2, 0.01, 0.0, lambda s: s.suspension_pressure()
            ),
        ],
        doip_address=0x1070,
    )


def _hu(*dtcs: SimDtc) -> SimEcuSpec:
    return SimEcuSpec(
        key="hu",
        name="Infotainment Head Unit",
        request_id=0x7D0,
        response_id=0x7D8,
        part_number="SIM-IHU-18C815-ST",
        hardware_version="H4.0",
        software_version="S25.06.0",
        serial_number="SIMH900012",
        dtcs=list(dtcs),
        supports_severity=False,
        supports_vin=False,
        doip_address=0x1080,
    )


def _snapshot(did: int, data: bytes) -> bytes:
    return did.to_bytes(2, "big") + data


PROFILES: dict[str, SimulationProfile] = {
    p.key: p
    for p in (
        SimulationProfile(
            key="range_rover",
            title="Range Rover (simulation profile)",
            vin=with_check_digit("SALKA9AE0RA900101"),
            facts={
                "model": "Range Rover",
                "engine": "3.0 I6 MHEV",
                "transmission": "8-speed automatic",
                "market": "EU",
            },
            ecus=(
                _gwm(
                    SimDtc(
                        dtc("P0562", 0x16),
                        HISTORY,
                        SEV_MAINTENANCE,
                        _snapshot(0x4201, b"\x2a\xf8"),
                        occurrence=3,
                    )
                ),
                _pcm(
                    SimDtc(
                        dtc("P0171"),
                        ACTIVE_MIL,
                        SEV_NEXT_HALT,
                        _snapshot(0x0105, b"\x7d"),
                        occurrence=5,
                        persistent=True,
                    ),
                    SimDtc(dtc("P0420"), HISTORY, SEV_MAINTENANCE, _snapshot(0x0105, b"\x82"), occurrence=1),
                ),
                _tcm(),
                _abs(),
                _bcm(
                    SimDtc(
                        dtc("B1A55", 0x11),
                        ACTIVE,
                        SEV_MAINTENANCE,
                        description="Rear wiper motor circuit (simulated manufacturer code)",
                    )
                ),
                _ipc(SimDtc(dtc("U0121"), HISTORY, SEV_NEXT_HALT, occurrence=2)),
                _rcm(),
                _ascm(
                    SimDtc(
                        dtc("C1A20", 0x64),
                        PENDING,
                        SEV_NEXT_HALT,
                        description="Front left height sensor (simulated manufacturer code)",
                    )
                ),
                _hu(),
            ),
        ),
        SimulationProfile(
            key="range_rover_sport",
            title="Range Rover Sport (simulation profile)",
            vin=with_check_digit("SALWA2AE0SA900202"),
            facts={
                "model": "Range Rover Sport",
                "engine": "3.0 I6 PHEV",
                "transmission": "8-speed automatic",
                "market": "UK",
            },
            ecus=(
                _gwm(),
                _pcm(
                    SimDtc(dtc("P0300"), PENDING, SEV_IMMEDIATE, _snapshot(0x010C, b"\x0c\x80"), occurrence=1)
                ),
                _tcm(SimDtc(dtc("P0715", 0x1C), ACTIVE_MIL, SEV_IMMEDIATE, persistent=True, occurrence=4)),
                _abs(),
                _bcm(),
                _ipc(SimDtc(dtc("U0101"), HISTORY, SEV_NEXT_HALT)),
                _ascm(),
                _hu(),
            ),
        ),
        SimulationProfile(
            key="defender",
            title="Defender (simulation profile)",
            vin=with_check_digit("SALEA7BW0PA900303"),
            facts={
                "model": "Defender",
                "engine": "3.0 I6 diesel MHEV",
                "transmission": "8-speed automatic",
                "market": "EU",
            },
            ecus=(
                _gwm(),
                _pcm(
                    SimDtc(dtc("P2463"), ACTIVE, SEV_NEXT_HALT, _snapshot(0x010D, b"\x00"), occurrence=2),
                    engine="D300",
                ),
                _tcm(),
                _abs(),
                _bcm(),
                _ipc(SimDtc(dtc("U0100"), HISTORY, SEV_IMMEDIATE)),
                _rcm(),
                _ascm(),
            ),
        ),
        SimulationProfile(
            key="discovery",
            title="Discovery (simulation profile)",
            vin=with_check_digit("SALRA2RV0NA900404"),
            facts={
                "model": "Discovery",
                "engine": "3.0 I6 diesel",
                "transmission": "8-speed automatic",
                "market": "UK",
            },
            ecus=(
                _gwm(),
                _pcm(SimDtc(dtc("P0128"), HISTORY, SEV_MAINTENANCE, occurrence=6)),
                _tcm(),
                _abs(),
                _bcm(),
                _ipc(),
                _rcm(),
                _ascm(),
                _hu(),
            ),
        ),
        SimulationProfile(
            key="discovery_sport",
            title="Discovery Sport (simulation profile)",
            vin=with_check_digit("SALCA2BN0PH900505"),
            facts={
                "model": "Discovery Sport",
                "engine": "2.0 I4 petrol MHEV",
                "transmission": "9-speed automatic",
                "market": "EU",
            },
            ecus=(
                _gwm(),
                _pcm(SimDtc(dtc("P0442"), PENDING, SEV_MAINTENANCE)),
                _tcm(),
                _abs(),
                _bcm(),
                _ipc(),
                _rcm(),
            ),
        ),
        SimulationProfile(
            key="evoque",
            title="Range Rover Evoque (simulation profile)",
            vin=with_check_digit("SALZA2BN0RH900606"),
            facts={
                "model": "Range Rover Evoque",
                "engine": "1.5 I3 PHEV",
                "transmission": "8-speed automatic",
                "market": "EU",
            },
            ecus=(_gwm(), _pcm(), _tcm(), _abs(), _bcm(), _ipc(), _rcm(), _hu()),
        ),
    )
}
