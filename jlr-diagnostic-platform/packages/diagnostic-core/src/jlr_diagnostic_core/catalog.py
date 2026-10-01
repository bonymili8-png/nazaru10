"""Versioned definition catalogs — the only place where meaning is attached to raw identifiers.

A catalog maps DTC codes to descriptions, DIDs to live parameters and extended-data records to
occurrence counters. Every catalog declares its :class:`EvidenceSource`:

* ``ISO_STANDARD`` — the built-in SAE J2012 generic DTC table (manufacturer-independent codes only)
* ``SIMULATION``   — shipped with simulator profiles; used only when the simulator is the interface
* ``USER_VERIFIED`` — JSON files supplied by the operator (``DefinitionCatalog.from_json``)

Lookups return the source alongside the value, so the UI can always show where a meaning came from.
Manufacturer-specific DTCs without a verified definition return no description rather than a guess.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from jlr_shared_types.models import EvidenceSource


def is_manufacturer_specific(code: str) -> bool:
    """SAE J2012 code ranges reserved for manufacturers (P1xxx, P30-P33, B/C/U 1xxx and 2xxx)."""

    code = code.upper()
    if len(code) != 5:
        return True
    system, digit = code[0], code[1]
    if system == "P":
        return digit == "1" or (digit == "3" and code[2] in "0123")
    return digit in "12"


# SAE J2012 generic (manufacturer-independent) DTC definitions. Deliberately a small, verified set;
# extend only from the standard itself.
SAE_J2012_GENERIC: dict[str, str] = {
    "P0100": "Mass or Volume Air Flow Sensor 'A' Circuit",
    "P0101": "Mass or Volume Air Flow Sensor 'A' Circuit Range/Performance",
    "P0113": "Intake Air Temperature Sensor 1 Circuit High",
    "P0128": "Coolant Thermostat (Coolant Temperature Below Thermostat Regulating Temperature)",
    "P0171": "System Too Lean (Bank 1)",
    "P0172": "System Too Rich (Bank 1)",
    "P0174": "System Too Lean (Bank 2)",
    "P0175": "System Too Rich (Bank 2)",
    "P0300": "Random/Multiple Cylinder Misfire Detected",
    "P0301": "Cylinder 1 Misfire Detected",
    "P0302": "Cylinder 2 Misfire Detected",
    "P0303": "Cylinder 3 Misfire Detected",
    "P0304": "Cylinder 4 Misfire Detected",
    "P0401": "Exhaust Gas Recirculation 'A' Flow Insufficient Detected",
    "P0420": "Catalyst System Efficiency Below Threshold (Bank 1)",
    "P0430": "Catalyst System Efficiency Below Threshold (Bank 2)",
    "P0442": "Evaporative Emission System Leak Detected (small leak)",
    "P0455": "Evaporative Emission System Leak Detected (large leak)",
    "P0500": "Vehicle Speed Sensor 'A'",
    "P0562": "System Voltage Low",
    "P0563": "System Voltage High",
    "P0606": "Control Module Processor",
    "P0700": "Transmission Control System (MIL Request)",
    "P0715": "Input/Turbine Speed Sensor 'A' Circuit",
    "P0730": "Incorrect Gear Ratio",
    "P2002": "Diesel Particulate Filter Efficiency Below Threshold (Bank 1)",
    "P2463": "Diesel Particulate Filter Restriction - Soot Accumulation (Bank 1)",
    "U0001": "High Speed CAN Communication Bus",
    "U0100": "Lost Communication With ECM/PCM 'A'",
    "U0101": "Lost Communication With TCM",
    "U0121": "Lost Communication With Anti-Lock Brake System (ABS) Control Module",
    "U0140": "Lost Communication With Body Control Module",
    "U0151": "Lost Communication With Restraints Control Module",
    "U0155": "Lost Communication With Instrument Panel Cluster (IPC) Control Module",
    "U0164": "Lost Communication With HVAC Control Module",
    "U0184": "Lost Communication With Radio",
    "U0401": "Invalid Data Received From ECM/PCM 'A'",
    "U0415": "Invalid Data Received From Anti-Lock Brake System (ABS) Control Module",
}


@dataclass(frozen=True, slots=True)
class DidParameter:
    """Linear decoding of a UDS DID into a live parameter value."""

    did: int
    name: str
    unit: str
    length: int
    scale: float = 1.0
    offset: float = 0.0
    signed: bool = False
    min_value: float | None = None
    max_value: float | None = None

    def decode(self, data: bytes) -> float:
        if len(data) < self.length:
            raise ValueError(f"DID 0x{self.did:04X} needs {self.length} bytes, got {len(data)}")
        raw = int.from_bytes(data[: self.length], "big", signed=self.signed)
        return raw * self.scale + self.offset


@dataclass(frozen=True, slots=True)
class OccurrenceRecord:
    """Which extended-data record holds the occurrence counter, and its width, for an ECU."""

    record_number: int
    length: int = 1


@dataclass(slots=True)
class DefinitionCatalog:
    name: str
    version: str
    source: EvidenceSource
    dtc_descriptions: dict[str, str] = field(default_factory=dict)
    # Keyed by ECU request address; ``None`` would mean "any ECU" and is deliberately not supported:
    # a DID's meaning is only ever valid for the ECU it was defined for.
    did_parameters: dict[int, list[DidParameter]] = field(default_factory=dict)
    occurrence_records: dict[int, OccurrenceRecord] = field(default_factory=dict)
    snapshot_record_lengths: dict[int, dict[int, int]] = field(default_factory=dict)

    @classmethod
    def from_json(
        cls, path: str | Path, *, source: EvidenceSource = EvidenceSource.USER_VERIFIED
    ) -> DefinitionCatalog:
        data: dict[str, Any] = json.loads(Path(path).read_text(encoding="utf-8"))
        return cls(
            name=str(data["name"]),
            version=str(data["version"]),
            source=source,
            dtc_descriptions={k.upper(): str(v) for k, v in data.get("dtc_descriptions", {}).items()},
            did_parameters={
                int(ecu, 16): [
                    DidParameter(
                        did=int(p["did"], 16),
                        name=p["name"],
                        unit=p.get("unit", ""),
                        length=int(p["length"]),
                        scale=float(p.get("scale", 1.0)),
                        offset=float(p.get("offset", 0.0)),
                        signed=bool(p.get("signed", False)),
                        min_value=p.get("min_value"),
                        max_value=p.get("max_value"),
                    )
                    for p in params
                ]
                for ecu, params in data.get("did_parameters", {}).items()
            },
            occurrence_records={
                int(ecu, 16): OccurrenceRecord(int(r["record_number"]), int(r.get("length", 1)))
                for ecu, r in data.get("occurrence_records", {}).items()
            },
        )


SAE_GENERIC_CATALOG = DefinitionCatalog(
    name="SAE J2012 generic DTCs",
    version="2026.1",
    source=EvidenceSource.ISO_STANDARD,
    dtc_descriptions=dict(SAE_J2012_GENERIC),
)


class CatalogSet:
    """Ordered catalogs; the first catalog that defines something wins."""

    def __init__(self, catalogs: list[DefinitionCatalog] | None = None) -> None:
        self.catalogs = catalogs if catalogs is not None else [SAE_GENERIC_CATALOG]

    def describe_dtc(self, code: str) -> tuple[str | None, EvidenceSource]:
        code = code.upper()
        manufacturer = is_manufacturer_specific(code)
        for catalog in self.catalogs:
            if code not in catalog.dtc_descriptions:
                continue
            if manufacturer and catalog.source is EvidenceSource.ISO_STANDARD:
                continue  # the generic table never speaks for manufacturer ranges
            return catalog.dtc_descriptions[code], catalog.source
        return None, EvidenceSource.NONE

    def did_parameters(self, ecu_request: int) -> list[tuple[DidParameter, EvidenceSource]]:
        seen: set[int] = set()
        result: list[tuple[DidParameter, EvidenceSource]] = []
        for catalog in self.catalogs:
            for parameter in catalog.did_parameters.get(ecu_request, []):
                if parameter.did not in seen:
                    seen.add(parameter.did)
                    result.append((parameter, catalog.source))
        return result

    def did_parameter(self, ecu_request: int, did: int) -> tuple[DidParameter, EvidenceSource] | None:
        for parameter, source in self.did_parameters(ecu_request):
            if parameter.did == did:
                return parameter, source
        return None

    def occurrence_record(self, ecu_request: int) -> OccurrenceRecord | None:
        for catalog in self.catalogs:
            if ecu_request in catalog.occurrence_records:
                return catalog.occurrence_records[ecu_request]
        return None

    def snapshot_lengths(self, ecu_request: int) -> dict[int, int] | None:
        for catalog in self.catalogs:
            if ecu_request in catalog.snapshot_record_lengths:
                return catalog.snapshot_record_lengths[ecu_request]
        return None

    def describe(self) -> list[dict[str, str]]:
        return [{"name": c.name, "version": c.version, "source": c.source.value} for c in self.catalogs]
