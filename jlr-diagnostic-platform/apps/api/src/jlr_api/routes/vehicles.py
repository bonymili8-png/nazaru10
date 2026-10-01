"""Vehicles, connection, full scan, ECUs, DTCs, live data and safety checks.

The VIN of a vehicle is never taken from the client: it is read from the vehicle by the gateway, and
every operation re-checks that the gateway is still connected to that VIN.
"""

from __future__ import annotations

import uuid
from typing import Annotated, Literal

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy import select

from jlr_api.context import Auth, Ctx, CurrentUser, Db, rate_limited, require
from jlr_api.db.models import ECU, DiagnosticSession, DTCEvent, ECUSoftware, Vehicle
from jlr_api.gateway_client import GatewayStatus
from jlr_api.schemas import (
    ClearDtcIn,
    ClearDtcOut,
    ConnectOut,
    DtcComparisonOut,
    DtcEventOut,
    DtcListOut,
    EcuOut,
    LiveParametersOut,
    LiveReadIn,
    SafetyCheckIn,
    SafetyOut,
    ScanOut,
    SessionDetailOut,
    SessionSummaryOut,
    VehicleDetailOut,
    VehicleOut,
)
from jlr_api.services import diagnostics as svc
from jlr_diagnostic_core.dtc import export_dtcs_csv, filter_dtcs, group_dtcs
from jlr_shared_types.errors import (
    CompatibilityError,
    DiagnosticError,
    NotConnectedError,
    NotFoundError,
    VinMismatchError,
)
from jlr_shared_types.models import Dtc, EcuInfo, LiveDataSnapshot, OperationRisk
from jlr_shared_types.permissions import Permission

router = APIRouter(tags=["vehicles"])

Connector = Annotated[CurrentUser, Depends(require(Permission.VEHICLE_CONNECT))]
Scanner = Annotated[CurrentUser, Depends(require(Permission.DIAGNOSTIC_SCAN))]
LiveReader = Annotated[CurrentUser, Depends(require(Permission.LIVE_DATA_READ))]
DtcClearer = Annotated[CurrentUser, Depends(require(Permission.DTC_CLEAR))]


async def ensure_gateway_on(ctx: Ctx, vehicle: Vehicle) -> GatewayStatus:
    status = await ctx.gateway.status()
    if not status.interface.connected:
        raise NotConnectedError("The diagnostic gateway is not connected to a vehicle; connect first")
    if status.vin != vehicle.vin:
        raise VinMismatchError(
            "The gateway is connected to a different vehicle",
            details={"vehicle_vin": vehicle.vin, "connected_vin": status.vin},
        )
    return status


# ------------------------------------------------------------------------------------------- connection


@router.post("/vehicles/connect", dependencies=[Depends(rate_limited("scan"))])
async def connect_vehicle(ctx: Ctx, db: Db, user: Connector) -> ConnectOut:
    async with svc.track_operation(ctx.sessions, user=user, operation="connect") as op:
        result = await ctx.gateway.connect()
        if result.identity.vin is None:
            raise CompatibilityError(
                "Connected, but no ECU reported a VIN; the vehicle cannot be identified",
                details={"identity": result.identity.model_dump(mode="json")},
            )
        vehicle, connection = await svc.upsert_vehicle(db, user, result)
        await db.commit()
        op.vehicle_id = vehicle.id
        op.response = {"vin": vehicle.vin, "interface": result.interface.kind.value}
        return ConnectOut(
            vehicle=VehicleOut.model_validate(vehicle),
            identity=result.identity,
            interface=result.interface,
            connection_id=connection.id,
        )


@router.post("/vehicles/disconnect")
async def disconnect_vehicle(ctx: Ctx, user: Connector) -> dict[str, bool]:
    async with svc.track_operation(ctx.sessions, user=user, operation="disconnect"):
        await ctx.gateway.disconnect()
    return {"connected": False}


# ------------------------------------------------------------------------------------------- vehicles


@router.get("/vehicles")
async def list_vehicles(db: Db, user: Auth) -> list[VehicleOut]:
    rows = await db.scalars(
        select(Vehicle)
        .where(Vehicle.owner_id == user.id)
        .order_by(Vehicle.last_connected_at.desc().nullslast())
    )
    return [VehicleOut.model_validate(v) for v in rows]


@router.get("/vehicles/{vehicle_id}")
async def vehicle_detail(vehicle_id: uuid.UUID, ctx: Ctx, db: Db, user: Auth) -> VehicleDetailOut:
    vehicle = await svc.get_vehicle_for(db, user, vehicle_id)
    session = await svc.latest_session(db, vehicle.id)
    total, active = await svc.dtc_counts(db, session.id) if session else (0, 0)
    gateway_vin = None
    interface = None
    try:
        status = await ctx.gateway.status()
        gateway_vin = status.vin
        interface = status.interface
    except DiagnosticError:
        pass
    return VehicleDetailOut(
        vehicle=VehicleOut.model_validate(vehicle),
        connected=bool(interface and interface.connected and gateway_vin == vehicle.vin),
        gateway_vin=gateway_vin,
        interface=interface,
        last_session=SessionSummaryOut.model_validate(session) if session else None,
        ecu_count=await svc.ecu_count(db, vehicle.id),
        dtc_count=total,
        active_dtc_count=active,
    )


# ------------------------------------------------------------------------------------------- scan


@router.post("/vehicles/{vehicle_id}/scan", dependencies=[Depends(rate_limited("scan"))])
async def full_scan(vehicle_id: uuid.UUID, ctx: Ctx, db: Db, user: Scanner) -> ScanOut:
    vehicle = await svc.get_vehicle_for(db, user, vehicle_id)
    async with svc.track_operation(
        ctx.sessions, user=user, operation="full_scan", vehicle_id=vehicle.id
    ) as op:
        await ensure_gateway_on(ctx, vehicle)
        scan = await ctx.gateway.scan()
        if scan.vehicle.vin != vehicle.vin:
            raise VinMismatchError(
                "VIN read during the scan does not match this vehicle",
                details={"vehicle_vin": vehicle.vin, "scanned_vin": scan.vehicle.vin},
            )
        parameters = await ctx.gateway.live_parameters()
        persisted = await svc.persist_scan(db, vehicle=vehicle, user=user, scan=scan, parameters=parameters)
        await db.commit()
        op.session_id = persisted.session.id
        op.response = {"ecus": len(scan.ecus), "dtcs": len(scan.dtcs), "duration_ms": scan.duration_ms}
        comparison = persisted.comparison
        return ScanOut(
            session_id=persisted.session.id,
            schema_version=scan.schema_version,
            vehicle=scan.vehicle.model_dump(mode="json"),
            ecus=scan.ecus,
            dtcs=scan.dtcs,
            warnings=scan.warnings,
            duration_ms=scan.duration_ms,
            probed_addresses=scan.probed_addresses,
            interface=scan.interface,
            comparison=DtcComparisonOut(
                appeared=[f"{d.ecu_id} {d.display}" for d in comparison.appeared],
                resolved=[f"{d.ecu_id} {d.display}" for d in comparison.resolved],
                status_changed=[f"{a.ecu_id} {a.display}" for _, a in comparison.status_changed],
            ),
            trace=scan.trace if user.user.professional_mode else None,
        )


@router.get("/vehicles/{vehicle_id}/sessions")
async def list_sessions(
    vehicle_id: uuid.UUID, db: Db, user: Auth, limit: Annotated[int, Query(ge=1, le=100)] = 20
) -> list[SessionSummaryOut]:
    vehicle = await svc.get_vehicle_for(db, user, vehicle_id)
    rows = await db.scalars(
        select(DiagnosticSession)
        .where(DiagnosticSession.vehicle_id == vehicle.id)
        .order_by(DiagnosticSession.started_at.desc())
        .limit(limit)
    )
    return [SessionSummaryOut.model_validate(r) for r in rows]


@router.get("/vehicles/{vehicle_id}/sessions/{session_id}")
async def session_detail(
    vehicle_id: uuid.UUID, session_id: uuid.UUID, db: Db, user: Auth
) -> SessionDetailOut:
    vehicle = await svc.get_vehicle_for(db, user, vehicle_id)
    session = await db.get(DiagnosticSession, session_id)
    if session is None or session.vehicle_id != vehicle.id:
        raise NotFoundError("Session not found")
    out = SessionDetailOut.model_validate(session)
    return out if user.user.professional_mode else out.model_copy(update={"trace": None})


# ------------------------------------------------------------------------------------------- ECUs


@router.get("/vehicles/{vehicle_id}/ecus")
async def list_ecus(vehicle_id: uuid.UUID, db: Db, user: Auth) -> list[EcuOut]:
    vehicle = await svc.get_vehicle_for(db, user, vehicle_id)
    rows = list(
        await db.scalars(select(ECU).where(ECU.vehicle_id == vehicle.id).order_by(ECU.request_address))
    )
    result: list[EcuOut] = []
    for row in rows:
        history = await db.scalars(
            select(ECUSoftware)
            .where(ECUSoftware.ecu_id == row.id)
            .order_by(ECUSoftware.recorded_at.desc())
            .limit(10)
        )
        result.append(
            EcuOut(
                ecu=EcuInfo.model_validate(row.info),
                first_seen_at=row.first_seen_at,
                last_seen_at=row.last_seen_at,
                software_history=[
                    {
                        "recorded_at": h.recorded_at.isoformat(),
                        "hardware_version": h.hardware_version,
                        "software_version": h.software_version,
                        "part_number": h.part_number,
                    }
                    for h in history
                ],
            )
        )
    return result


# ------------------------------------------------------------------------------------------- DTCs

StateFilter = Literal["any", "active", "confirmed", "pending", "history"]


async def _filtered_dtcs(
    db: Db,
    user: CurrentUser,
    vehicle: Vehicle,
    *,
    ecu_id: str | None,
    state: StateFilter,
    system: str | None = None,
    search: str | None = None,
) -> tuple[DiagnosticSession | None, list[Dtc]]:
    session = await svc.latest_session(db, vehicle.id)
    dtcs = await svc.session_dtcs(db, session.id) if session else []
    return session, filter_dtcs(dtcs, ecu_id=ecu_id, state=state, system=system, search=search)


@router.get("/vehicles/{vehicle_id}/dtcs")
async def list_dtcs(
    vehicle_id: uuid.UUID,
    db: Db,
    user: Auth,
    ecu_id: str | None = None,
    state: StateFilter = "any",
    system: Annotated[str | None, Query(pattern="^[PCBUpcbu]$")] = None,
    search: Annotated[str | None, Query(max_length=64)] = None,
    group_by: Literal["ecu", "system", "severity"] | None = None,
) -> DtcListOut:
    vehicle = await svc.get_vehicle_for(db, user, vehicle_id)
    session, dtcs = await _filtered_dtcs(
        db, user, vehicle, ecu_id=ecu_id, state=state, system=system, search=search
    )
    return DtcListOut(
        session_id=session.id if session else None,
        read_at=session.finished_at if session else None,
        total=len(dtcs),
        dtcs=dtcs,
        groups=group_dtcs(dtcs, group_by) if group_by else None,
    )


@router.get("/vehicles/{vehicle_id}/dtcs/export.csv")
async def export_dtcs(
    vehicle_id: uuid.UUID,
    db: Db,
    user: Auth,
    ecu_id: str | None = None,
    state: StateFilter = "any",
) -> Response:
    vehicle = await svc.get_vehicle_for(db, user, vehicle_id)
    _, dtcs = await _filtered_dtcs(db, user, vehicle, ecu_id=ecu_id, state=state)
    return Response(
        export_dtcs_csv(dtcs),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="dtcs-{vehicle.vin}.csv"'},
    )


@router.get("/vehicles/{vehicle_id}/dtc-events")
async def dtc_events(
    vehicle_id: uuid.UUID, db: Db, user: Auth, limit: Annotated[int, Query(ge=1, le=500)] = 100
) -> list[DtcEventOut]:
    vehicle = await svc.get_vehicle_for(db, user, vehicle_id)
    rows = await db.scalars(
        select(DTCEvent)
        .where(DTCEvent.vehicle_id == vehicle.id)
        .order_by(DTCEvent.occurred_at.desc())
        .limit(limit)
    )
    return [DtcEventOut.model_validate(r) for r in rows]


@router.post("/vehicles/{vehicle_id}/dtcs/clear", dependencies=[Depends(rate_limited("mutation"))])
async def clear_dtcs(
    vehicle_id: uuid.UUID, body: ClearDtcIn, ctx: Ctx, db: Db, user: DtcClearer
) -> ClearDtcOut:
    vehicle = await svc.get_vehicle_for(db, user, vehicle_id)
    ecu = await db.scalar(select(ECU).where(ECU.vehicle_id == vehicle.id, ECU.ecu_key == body.ecu_id))
    software_version = (ecu.info or {}).get("software_version") if ecu else None
    request = {"ecu_id": body.ecu_id, "confirm": body.confirm, "vehicle_id": str(vehicle.id)}
    async with svc.track_operation(
        ctx.sessions,
        user=user,
        operation="clear_dtc",
        vehicle_id=vehicle.id,
        ecu_key=body.ecu_id,
        request=request,
    ) as op:
        try:
            await ensure_gateway_on(ctx, vehicle)
            result = await ctx.gateway.clear_dtcs(
                body.ecu_id, expected_vin=vehicle.vin, confirm=body.confirm, permissions=user.permissions
            )
        except DiagnosticError as exc:
            await svc.write_audit(
                ctx.sessions,
                user=user,
                operation="clear_dtc",
                vin=vehicle.vin,
                ecu=body.ecu_id,
                request=request,
                result="BLOCKED"
                if exc.code.value
                in {
                    "SAFETY_BLOCKED",
                    "LOW_VOLTAGE",
                    "VIN_MISMATCH",
                    "CONFIRMATION_REQUIRED",
                    "PERMISSION_DENIED",
                }
                else "FAILED",
                error=exc.to_payload(),
                software_version=software_version,
            )
            raise
        audit_id = await svc.write_audit(
            ctx.sessions,
            user=user,
            operation="clear_dtc",
            vin=vehicle.vin,
            ecu=body.ecu_id,
            request=request,
            result="SUCCESS",
            old_value={"dtcs": [d.display for d in result.dtcs_before]},
            new_value={"dtcs": [d.display for d in result.dtcs_after]},
            response={
                "cleared": result.cleared,
                "safety": result.safety.model_dump(mode="json"),
                "duration_ms": result.duration_ms,
            },
            software_version=software_version,
        )
        db.add(
            DTCEvent(
                vehicle_id=vehicle.id,
                ecu_key=body.ecu_id,
                display="*",
                event="CLEARED",
                details={
                    "before": [d.display for d in result.dtcs_before],
                    "after": [d.display for d in result.dtcs_after],
                    "audit_id": audit_id,
                },
            )
        )
        await db.commit()
        op.response = {"audit_id": audit_id}
        return ClearDtcOut(result=result, audit_id=audit_id)


# ------------------------------------------------------------------------------------------- live data


@router.get("/vehicles/{vehicle_id}/live-data/parameters")
async def live_parameters(vehicle_id: uuid.UUID, ctx: Ctx, db: Db, user: LiveReader) -> LiveParametersOut:
    vehicle = await svc.get_vehicle_for(db, user, vehicle_id)
    await ensure_gateway_on(ctx, vehicle)
    return LiveParametersOut(vin=vehicle.vin, parameters=await ctx.gateway.live_parameters())


@router.post("/vehicles/{vehicle_id}/live-data", dependencies=[Depends(rate_limited("live"))])
async def read_live(
    vehicle_id: uuid.UUID, body: LiveReadIn, ctx: Ctx, db: Db, user: LiveReader
) -> LiveDataSnapshot:
    vehicle = await svc.get_vehicle_for(db, user, vehicle_id)
    await ensure_gateway_on(ctx, vehicle)
    snapshot = await ctx.gateway.read_live(body.parameter_ids)
    if snapshot.vin != vehicle.vin:
        raise VinMismatchError("Live data came from a different vehicle")
    return snapshot


@router.post("/vehicles/{vehicle_id}/safety")
async def safety_check(vehicle_id: uuid.UUID, body: SafetyCheckIn, ctx: Ctx, db: Db, user: Auth) -> SafetyOut:
    vehicle = await svc.get_vehicle_for(db, user, vehicle_id)
    await ensure_gateway_on(ctx, vehicle)
    return SafetyOut(decision=await ctx.gateway.check_safety(body.operation, OperationRisk(body.risk)))
