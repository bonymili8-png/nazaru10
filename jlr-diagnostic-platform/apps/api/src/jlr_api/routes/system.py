"""Health, readiness, gateway status, audit log and operation history."""

from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import select, text

from jlr_api.context import Auth, Ctx, Db
from jlr_api.db.models import AuditLog, DiagnosticOperation
from jlr_api.schemas import AuditOut, GatewayStatusOut, OperationOut
from jlr_shared_types.errors import DiagnosticError
from jlr_shared_types.permissions import Permission

router = APIRouter(tags=["system"])


@router.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/ready")
async def ready(ctx: Ctx, db: Db) -> dict[str, object]:
    await db.execute(text("SELECT 1"))
    gateway: dict[str, object]
    try:
        gateway = {"reachable": True, **(await ctx.gateway.health())}
    except DiagnosticError as exc:
        gateway = {"reachable": False, "error": exc.code.value}
    return {"status": "ok", "database": "ok", "gateway": gateway}


@router.get("/gateway/status")
async def gateway_status(ctx: Ctx, user: Auth) -> GatewayStatusOut:
    try:
        status = await ctx.gateway.status()
    except DiagnosticError as exc:
        return GatewayStatusOut(reachable=False, error=exc.to_payload())
    return GatewayStatusOut(
        reachable=True,
        interface=status.interface,
        vin=status.vin,
        busy_with=status.busy_with,
        simulation=status.simulation,
        catalogs=status.catalogs,
        protocols=status.protocols,
    )


@router.get("/audit")
async def audit_log(
    db: Db, user: Auth, limit: Annotated[int, Query(ge=1, le=500)] = 100, all_users: bool = False
) -> list[AuditOut]:
    query = select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)
    if not (all_users and user.has(Permission.AUDIT_READ_ALL)):
        query = query.where(AuditLog.user_id == user.id)
    return [AuditOut.model_validate(r) for r in await db.scalars(query)]


@router.get("/operations")
async def operations(
    db: Db, user: Auth, limit: Annotated[int, Query(ge=1, le=200)] = 50
) -> list[OperationOut]:
    rows = await db.scalars(
        select(DiagnosticOperation)
        .where(DiagnosticOperation.user_id == user.id)
        .order_by(DiagnosticOperation.started_at.desc())
        .limit(limit)
    )
    return [OperationOut.model_validate(r) for r in rows]
