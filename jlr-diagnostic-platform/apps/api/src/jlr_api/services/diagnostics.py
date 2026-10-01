"""Persistence of connections, scans, DTC history, live parameters, operations and audit entries."""

from __future__ import annotations

import time
import uuid
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from jlr_api.context import CurrentUser
from jlr_api.db.models import (
    DTC,
    ECU,
    AuditLog,
    DiagnosticOperation,
    DiagnosticSession,
    DTCEvent,
    ECUSoftware,
    LiveParameter,
    Vehicle,
    VehicleConnection,
)
from jlr_diagnostic_core.dtc import DtcComparison, compare_dtcs
from jlr_diagnostic_core.observability import correlation_id_var
from jlr_shared_types.errors import DiagnosticError, NotFoundError
from jlr_shared_types.models import (
    VEHICLE_PROFILE_SCHEMA_VERSION,
    ConnectResult,
    Dtc,
    InterfaceKind,
    LiveParameterDefinition,
    ScanResult,
)
from jlr_shared_types.permissions import Permission


def _fact(profile: dict[str, Any], key: str) -> Any:
    value = profile.get(key)
    return value.get("value") if isinstance(value, dict) else None


# ------------------------------------------------------------------------------------------- vehicles


async def get_vehicle_for(db: AsyncSession, user: CurrentUser, vehicle_id: uuid.UUID) -> Vehicle:
    vehicle = await db.get(Vehicle, vehicle_id)
    if vehicle is None or (vehicle.owner_id != user.id and not user.has(Permission.AUDIT_READ_ALL)):
        raise NotFoundError("Vehicle not found")
    return vehicle


async def upsert_vehicle(
    db: AsyncSession, user: CurrentUser, result: ConnectResult
) -> tuple[Vehicle, VehicleConnection]:
    vin = result.identity.vin
    assert vin is not None
    vehicle = await db.scalar(select(Vehicle).where(Vehicle.owner_id == user.id, Vehicle.vin == vin))
    profile = result.profile
    make = _fact(profile, "make")
    model = _fact(profile, "model")
    year = _fact(profile, "model_year")
    display = " ".join(str(p) for p in (year, make, model) if p) or vin
    now = datetime.now(UTC)
    if vehicle is None:
        vehicle = Vehicle(owner_id=user.id, vin=vin, created_at=now)
        db.add(vehicle)
    vehicle.make = make
    vehicle.model = model
    vehicle.model_year = int(year) if isinstance(year, int) else None
    vehicle.display_name = display
    vehicle.profile = profile
    vehicle.profile_schema_version = str(profile.get("schema_version", VEHICLE_PROFILE_SCHEMA_VERSION))
    vehicle.simulation = result.interface.simulation or result.interface.kind is InterfaceKind.MOCK
    vehicle.last_connected_at = now
    await db.flush()
    connection = VehicleConnection(
        vehicle_id=vehicle.id,
        user_id=user.id,
        interface_kind=result.interface.kind.value,
        simulation=result.interface.simulation,
        description=result.interface.description[:255],
        vehicle_voltage=result.interface.vehicle_voltage,
        identity=result.identity.model_dump(mode="json"),
        connected_at=now,
    )
    db.add(connection)
    await db.flush()
    return vehicle, connection


# ------------------------------------------------------------------------------------------- scans


async def latest_session(db: AsyncSession, vehicle_id: uuid.UUID) -> DiagnosticSession | None:
    return await db.scalar(
        select(DiagnosticSession)
        .where(DiagnosticSession.vehicle_id == vehicle_id, DiagnosticSession.status == "completed")
        .order_by(DiagnosticSession.started_at.desc())
        .limit(1)
    )


async def session_dtcs(db: AsyncSession, session_id: uuid.UUID) -> list[Dtc]:
    rows = await db.scalars(
        select(DTC).where(DTC.session_id == session_id).order_by(DTC.ecu_key, DTC.display)
    )
    return [Dtc.model_validate(row.data) for row in rows]


@dataclass
class PersistedScan:
    session: DiagnosticSession
    comparison: DtcComparison
    ecu_rows: dict[str, ECU] = field(default_factory=dict)


async def persist_scan(
    db: AsyncSession,
    *,
    vehicle: Vehicle,
    user: CurrentUser,
    scan: ScanResult,
    parameters: list[LiveParameterDefinition],
) -> PersistedScan:
    previous = await latest_session(db, vehicle.id)
    previous_dtcs = await session_dtcs(db, previous.id) if previous else []
    now = datetime.now(UTC)
    session = DiagnosticSession(
        vehicle_id=vehicle.id,
        user_id=user.id,
        kind="full_scan",
        status="completed",
        started_at=scan.started_at,
        finished_at=now,
        duration_ms=scan.duration_ms,
        ecu_count=len(scan.ecus),
        dtc_count=len(scan.dtcs),
        probed_addresses=scan.probed_addresses,
        warnings=scan.warnings,
        interface=scan.interface.model_dump(mode="json"),
        vehicle_snapshot=scan.vehicle.model_dump(mode="json"),
        trace=scan.trace,
        result_schema_version=scan.schema_version,
        correlation_id=correlation_id_var.get(),
    )
    db.add(session)
    await db.flush()

    existing = {e.ecu_key: e for e in await db.scalars(select(ECU).where(ECU.vehicle_id == vehicle.id))}
    ecu_rows: dict[str, ECU] = {}
    for info in scan.ecus:
        row = existing.get(info.id)
        if row is None:
            row = ECU(vehicle_id=vehicle.id, ecu_key=info.id, first_seen_at=now)
            db.add(row)
        row.name = info.name
        row.name_source = info.name_source.value
        row.request_address = info.request_address
        row.response_address = info.response_address
        row.protocol = info.protocol
        row.capabilities = info.capabilities.model_dump(mode="json")
        row.info = info.model_dump(mode="json")
        row.last_seen_at = now
        row.last_session_id = session.id
        ecu_rows[info.id] = row
    await db.flush()
    for info in scan.ecus:
        db.add(
            ECUSoftware(
                ecu_id=ecu_rows[info.id].id,
                session_id=session.id,
                hardware_version=info.hardware_version,
                software_version=info.software_version,
                part_number=info.part_number,
                serial_number=info.serial_number,
                identification=[v.model_dump(mode="json") for v in info.identification],
                recorded_at=now,
            )
        )
    for dtc in scan.dtcs:
        ecu_row = ecu_rows.get(dtc.ecu_id)
        if ecu_row is None:
            continue
        db.add(
            DTC(
                session_id=session.id,
                vehicle_id=vehicle.id,
                ecu_id=ecu_row.id,
                ecu_key=dtc.ecu_id,
                code=dtc.code,
                display=dtc.display,
                raw=dtc.raw,
                status_byte=dtc.status_byte,
                description=dtc.description,
                description_source=dtc.description_source.value,
                severity=dtc.severity.value,
                occurrence_count=dtc.occurrence_count,
                data=dtc.model_dump(mode="json"),
                read_at=dtc.read_at,
            )
        )

    comparison = compare_dtcs(previous_dtcs, scan.dtcs)
    for d in comparison.appeared:
        db.add(
            DTCEvent(
                vehicle_id=vehicle.id,
                session_id=session.id,
                ecu_key=d.ecu_id,
                display=d.display,
                event="APPEARED",
                details={"status_byte": d.status_byte},
                occurred_at=now,
            )
        )
    # Only ECUs that were scanned this time can prove a DTC is gone.
    scanned_ecus = {e.id for e in scan.ecus}
    for d in comparison.resolved:
        if d.ecu_id in scanned_ecus:
            db.add(
                DTCEvent(
                    vehicle_id=vehicle.id,
                    session_id=session.id,
                    ecu_key=d.ecu_id,
                    display=d.display,
                    event="RESOLVED",
                    details={"last_status_byte": d.status_byte},
                    occurred_at=now,
                )
            )
    for before, after in comparison.status_changed:
        db.add(
            DTCEvent(
                vehicle_id=vehicle.id,
                session_id=session.id,
                ecu_key=after.ecu_id,
                display=after.display,
                event="STATUS_CHANGED",
                details={"from": before.status_byte, "to": after.status_byte},
                occurred_at=now,
            )
        )

    known = {
        p.parameter_key: p
        for p in await db.scalars(select(LiveParameter).where(LiveParameter.vehicle_id == vehicle.id))
    }
    for parameter in parameters:
        param_row = known.get(parameter.id) or LiveParameter(
            vehicle_id=vehicle.id, parameter_key=parameter.id, discovered_at=now
        )
        param_row.ecu_key = parameter.ecu_id
        param_row.name = parameter.name
        param_row.unit = parameter.unit
        param_row.access = parameter.access
        param_row.identifier = parameter.identifier
        param_row.source = parameter.source.value
        if parameter.id not in known:
            db.add(param_row)

    vehicle.last_scan_at = now
    await db.flush()
    return PersistedScan(session=session, comparison=comparison, ecu_rows=ecu_rows)


async def dtc_counts(db: AsyncSession, session_id: uuid.UUID) -> tuple[int, int]:
    dtcs = await session_dtcs(db, session_id)
    return len(dtcs), sum(1 for d in dtcs if d.status.test_failed)


async def ecu_count(db: AsyncSession, vehicle_id: uuid.UUID) -> int:
    return int(
        await db.scalar(select(func.count()).select_from(ECU).where(ECU.vehicle_id == vehicle_id)) or 0
    )


# ------------------------------------------------------------------------------------------- operations


@asynccontextmanager
async def track_operation(
    sessions: async_sessionmaker[AsyncSession],
    *,
    user: CurrentUser,
    operation: str,
    vehicle_id: uuid.UUID | None = None,
    ecu_key: str | None = None,
    request: dict[str, Any] | None = None,
) -> AsyncIterator[DiagnosticOperation]:
    """Record the operation lifecycle in its own transaction so failures are recorded too."""

    started = time.monotonic()
    async with sessions() as db:
        record = DiagnosticOperation(
            user_id=user.id,
            vehicle_id=vehicle_id,
            operation=operation,
            ecu_key=ecu_key,
            status="running",
            request=request or {},
            correlation_id=correlation_id_var.get(),
        )
        db.add(record)
        await db.commit()
        operation_id = record.id
    error: dict[str, Any] | None = None
    try:
        yield record
    except DiagnosticError as exc:
        error = exc.to_payload()
        raise
    except Exception as exc:
        error = {"code": "INTERNAL_ERROR", "message": type(exc).__name__}
        raise
    finally:
        async with sessions() as db:
            stored = await db.get(DiagnosticOperation, operation_id)
            if stored is not None:
                stored.status = "failed" if error else "completed"
                stored.error = error
                stored.response = record.response
                stored.session_id = record.session_id
                stored.vehicle_id = record.vehicle_id or stored.vehicle_id
                stored.finished_at = datetime.now(UTC)
                stored.duration_ms = round((time.monotonic() - started) * 1000)
                await db.commit()


async def write_audit(
    sessions: async_sessionmaker[AsyncSession],
    *,
    user: CurrentUser,
    operation: str,
    vin: str | None,
    ecu: str | None,
    request: dict[str, Any],
    result: str,
    old_value: dict[str, Any] | None = None,
    new_value: dict[str, Any] | None = None,
    response: dict[str, Any] | None = None,
    error: dict[str, Any] | None = None,
    software_version: str | None = None,
) -> int:
    """Append an audit entry in its own transaction (independent of the caller's outcome)."""

    async with sessions() as db:
        entry = AuditLog(
            user_id=user.id,
            telegram_id=user.user.telegram_id,
            vin=vin,
            ecu=ecu,
            operation=operation,
            old_value=old_value,
            new_value=new_value,
            request=request,
            response=response,
            result=result,
            error=error,
            software_version=software_version,
            correlation_id=correlation_id_var.get(),
        )
        db.add(entry)
        await db.commit()
        return entry.id
