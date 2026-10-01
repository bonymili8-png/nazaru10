"""DTC engine: read (UDS 0x19), enrich, filter, group, compare and export.

Reading is per ECU. Enrichment (severity, freeze frames, occurrence) uses standard sub-functions
and degrades gracefully: whatever an ECU refuses is reported through its capability, never invented.
"""

from __future__ import annotations

import csv
import io
from collections import defaultdict
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Literal

from jlr_diagnostic_core.capabilities import capability_from_error
from jlr_diagnostic_core.catalog import CatalogSet
from jlr_protocols.uds import DtcStatus, UdsClient, dtc_code, dtc_display, failure_type_description
from jlr_protocols.uds.codec import DtcSeverityRecord
from jlr_protocols.uds.constants import (
    DTC_SEVERITY_CHECK_AT_NEXT_HALT,
    DTC_SEVERITY_CHECK_IMMEDIATELY,
    DTC_SEVERITY_MAINTENANCE_ONLY,
)
from jlr_shared_types.errors import DiagnosticConnectionError, DiagnosticError
from jlr_shared_types.models import (
    Capability,
    CapabilityStatus,
    Dtc,
    DtcSeverity,
    DtcStatusFlags,
    EvidenceSource,
    FreezeFrameRecord,
)


def severity_from_bits(severity: int) -> DtcSeverity:
    if severity & DTC_SEVERITY_CHECK_IMMEDIATELY:
        return DtcSeverity.CHECK_IMMEDIATELY
    if severity & DTC_SEVERITY_CHECK_AT_NEXT_HALT:
        return DtcSeverity.CHECK_AT_NEXT_HALT
    if severity & DTC_SEVERITY_MAINTENANCE_ONLY:
        return DtcSeverity.MAINTENANCE_ONLY
    return DtcSeverity.NO_CLASS


@dataclass(slots=True)
class EcuDtcReadout:
    dtcs: list[Dtc] = field(default_factory=list)
    read_dtc: Capability = field(default_factory=Capability.unknown)
    severity: Capability = field(default_factory=Capability.unknown)
    freeze_frames: Capability = field(default_factory=Capability.unknown)
    warnings: list[str] = field(default_factory=list)


def build_dtc(
    *,
    ecu_id: str,
    ecu_name: str,
    raw: int,
    status_byte: int,
    catalog: CatalogSet,
    read_at: datetime,
    severity: DtcSeverity = DtcSeverity.UNKNOWN,
    severity_source: EvidenceSource = EvidenceSource.NONE,
    freeze_frames: list[FreezeFrameRecord] | None = None,
    extended_data_hex: str | None = None,
    occurrence_count: int | None = None,
) -> Dtc:
    code = dtc_code(raw)
    description, description_source = catalog.describe_dtc(code)
    status = DtcStatus(status_byte)
    if severity is DtcSeverity.UNKNOWN and status.warning_indicator_requested:
        severity, severity_source = DtcSeverity.WARNING_INDICATOR, EvidenceSource.ECU_RESPONSE
    return Dtc(
        ecu_id=ecu_id,
        ecu_name=ecu_name,
        code=code,
        display=dtc_display(raw),
        raw=raw,
        failure_type=raw & 0xFF,
        failure_type_description=failure_type_description(raw & 0xFF),
        status_byte=status_byte,
        status=DtcStatusFlags(**status.as_dict()),
        description=description,
        description_source=description_source,
        severity=severity,
        severity_source=severity_source,
        occurrence_count=occurrence_count,
        freeze_frames=freeze_frames or [],
        extended_data_hex=extended_data_hex,
        read_at=read_at,
    )


async def read_ecu_dtcs(
    client: UdsClient,
    *,
    ecu_id: str,
    ecu_name: str,
    ecu_request: int,
    catalog: CatalogSet,
    details_limit: int = 20,
) -> EcuDtcReadout:
    """Read stored DTCs of one ECU with severity, freeze frames and occurrence where available."""

    readout = EcuDtcReadout()
    read_at = datetime.now(UTC)
    try:
        _availability, records = await client.read_dtc_by_status(0xFF)
    except DiagnosticConnectionError:
        raise
    except DiagnosticError as exc:
        readout.read_dtc = capability_from_error(exc, "ReadDTCInformation 0x19 0x02")
        readout.warnings.append(f"{ecu_id}: DTCs could not be read ({exc.message})")
        return readout
    readout.read_dtc = Capability(
        status=CapabilityStatus.SUPPORTED,
        source=EvidenceSource.ECU_RESPONSE,
        evidence="Positive response to ReadDTCInformation 0x19 0x02",
    )
    # Only DTCs with at least one status bit set are of interest (0x00 = no failure recorded).
    records = [r for r in records if r.status]
    if not records:
        return readout

    severities: dict[int, DtcSeverityRecord] = {}
    try:
        _, severity_records = await client.read_dtc_by_severity(0xFF, 0xFF)
        severities = {r.dtc: r for r in severity_records}
        readout.severity = Capability(
            status=CapabilityStatus.SUPPORTED,
            source=EvidenceSource.ECU_RESPONSE,
            evidence="Positive response to ReadDTCInformation 0x19 0x08",
        )
    except DiagnosticConnectionError:
        raise
    except DiagnosticError as exc:
        readout.severity = capability_from_error(exc, "ReadDTCInformation 0x19 0x08")

    snapshot_lengths = catalog.snapshot_lengths(ecu_request)
    occurrence_def = catalog.occurrence_record(ecu_request)
    freeze_frame_errors = 0
    for index, record in enumerate(records):
        freeze_frames: list[FreezeFrameRecord] = []
        extended_hex: str | None = None
        occurrence: int | None = None
        if index < details_limit and readout.freeze_frames.status is not CapabilityStatus.NOT_SUPPORTED:
            try:
                snapshot = await client.read_dtc_snapshot(record.dtc, 0xFF, snapshot_lengths)
                freeze_frames = [
                    FreezeFrameRecord(
                        record_number=s.record_number,
                        raw_hex=s.raw.hex().upper(),
                        identifiers=[
                            {
                                "did": f"0x{int.from_bytes(s.raw[:2], 'big'):04X}",
                                "data_hex": s.raw[2:].hex().upper(),
                            }
                        ]
                        if s.identifier_count == 1 and len(s.raw) >= 2
                        else [],
                        decoded=s.identifier_count == 1 and len(s.raw) >= 2,
                        note=None
                        if s.identifier_count == 1
                        else "Multiple identifiers: splitting needs the ECU's data definition",
                    )
                    for s in snapshot.records
                ]
                readout.freeze_frames = Capability(
                    status=CapabilityStatus.SUPPORTED,
                    source=EvidenceSource.ECU_RESPONSE,
                    evidence="Positive response to ReadDTCInformation 0x19 0x04",
                )
            except DiagnosticConnectionError:
                raise
            except DiagnosticError as exc:
                freeze_frame_errors += 1
                capability = capability_from_error(exc, "ReadDTCInformation 0x19 0x04")
                if capability.status is CapabilityStatus.NOT_SUPPORTED or freeze_frame_errors >= 3:
                    readout.freeze_frames = capability
            if occurrence_def is not None:
                try:
                    _, _, ext = await client.read_dtc_extended_data(record.dtc, occurrence_def.record_number)
                    extended_hex = ext.hex().upper()
                    # Layout: recordNumber, then the record's data.
                    if len(ext) >= 1 + occurrence_def.length and ext[0] == occurrence_def.record_number:
                        occurrence = int.from_bytes(ext[1 : 1 + occurrence_def.length], "big")
                except DiagnosticConnectionError:
                    raise
                except DiagnosticError:
                    pass
        severity_record = severities.get(record.dtc)
        readout.dtcs.append(
            build_dtc(
                ecu_id=ecu_id,
                ecu_name=ecu_name,
                raw=record.dtc,
                status_byte=record.status,
                catalog=catalog,
                read_at=read_at,
                severity=severity_from_bits(severity_record.severity)
                if severity_record
                else DtcSeverity.UNKNOWN,
                severity_source=EvidenceSource.ECU_RESPONSE if severity_record else EvidenceSource.NONE,
                freeze_frames=freeze_frames,
                extended_data_hex=extended_hex,
                occurrence_count=occurrence,
            )
        )
    if len(records) > details_limit:
        readout.warnings.append(
            f"{ecu_id}: freeze frames read for the first {details_limit} of {len(records)} DTCs only"
        )
    return readout


# --------------------------------------------------------------------------------------------------
# Filter / group / compare / export (pure functions shared by gateway, API and tests)
# --------------------------------------------------------------------------------------------------

DtcStateFilter = Literal["any", "active", "confirmed", "pending", "history"]


def filter_dtcs(
    dtcs: Iterable[Dtc],
    *,
    ecu_id: str | None = None,
    state: DtcStateFilter = "any",
    system: str | None = None,
    search: str | None = None,
) -> list[Dtc]:
    def keep(d: Dtc) -> bool:
        if ecu_id and d.ecu_id.lower() != ecu_id.lower():
            return False
        if system and not d.code.upper().startswith(system.upper()):
            return False
        if state == "active" and not d.status.test_failed:
            return False
        if state == "confirmed" and not d.status.confirmed:
            return False
        if state == "pending" and not d.status.pending:
            return False
        if state == "history" and (d.status.test_failed or not d.status.confirmed):
            return False
        if search:
            needle = search.lower()
            return needle in d.display.lower() or needle in (d.description or "").lower()
        return True

    return [d for d in dtcs if keep(d)]


GroupKey = Literal["ecu", "system", "severity"]
_SYSTEM_NAMES = {"P": "Powertrain", "C": "Chassis", "B": "Body", "U": "Network"}


def group_dtcs(dtcs: Iterable[Dtc], by: GroupKey) -> dict[str, list[Dtc]]:
    groups: dict[str, list[Dtc]] = defaultdict(list)
    for d in dtcs:
        if by == "ecu":
            key = f"{d.ecu_name} ({d.ecu_id})"
        elif by == "system":
            key = _SYSTEM_NAMES.get(d.code[0], d.code[0])
        else:
            key = d.severity.value
        groups[key].append(d)
    return dict(groups)


@dataclass(frozen=True, slots=True)
class DtcComparison:
    appeared: list[Dtc]
    resolved: list[Dtc]
    persisting: list[Dtc]
    status_changed: list[tuple[Dtc, Dtc]]


def _dtc_key(d: Dtc) -> tuple[str, int]:
    return d.ecu_id, d.raw


def compare_dtcs(previous: Sequence[Dtc], current: Sequence[Dtc]) -> DtcComparison:
    before = {_dtc_key(d): d for d in previous}
    after = {_dtc_key(d): d for d in current}
    return DtcComparison(
        appeared=[d for k, d in after.items() if k not in before],
        resolved=[d for k, d in before.items() if k not in after],
        persisting=[d for k, d in after.items() if k in before],
        status_changed=[
            (before[k], d) for k, d in after.items() if k in before and before[k].status_byte != d.status_byte
        ],
    )


CSV_COLUMNS = (
    "ecu_id",
    "ecu_name",
    "display",
    "description",
    "description_source",
    "status_byte",
    "active",
    "confirmed",
    "pending",
    "warning_indicator",
    "severity",
    "occurrence_count",
    "read_at",
)


def _csv_safe(value: object) -> str:
    """Neutralise spreadsheet formula injection in exported cells."""

    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@") else text


def export_dtcs_csv(dtcs: Iterable[Dtc]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(CSV_COLUMNS)
    for d in dtcs:
        writer.writerow(
            [
                _csv_safe(v)
                for v in (
                    d.ecu_id,
                    d.ecu_name,
                    d.display,
                    d.description or "",
                    d.description_source.value,
                    f"0x{d.status_byte:02X}",
                    d.status.test_failed,
                    d.status.confirmed,
                    d.status.pending,
                    d.status.warning_indicator_requested,
                    d.severity.value,
                    d.occurrence_count if d.occurrence_count is not None else "",
                    d.read_at.isoformat(),
                )
            ]
        )
    return buffer.getvalue()
