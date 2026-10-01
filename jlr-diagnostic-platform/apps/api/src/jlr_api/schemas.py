"""Public API request/response models (``/api/v1``)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

from jlr_shared_types.models import (
    ClearDtcResult,
    Dtc,
    EcuInfo,
    InterfaceStatus,
    LiveParameterDefinition,
    OperationRisk,
    SafetyDecision,
    VehicleIdentity,
)


class In(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ------------------------------------------------------------------------------------------- auth


class TelegramAuthIn(In):
    init_data: str = Field(min_length=1, max_length=4096)


class DevAuthIn(In):
    telegram_id: int = Field(default=100_000_001, ge=1)
    username: str | None = Field(default="developer", max_length=64)
    first_name: str | None = Field(default="Developer", max_length=128)


class UserOut(Out):
    id: uuid.UUID
    telegram_id: int
    username: str | None
    first_name: str | None
    role: str
    professional_mode: bool
    permissions: list[str] = Field(default_factory=list)


class TokenOut(BaseModel):
    access_token: str
    token_type: Literal["bearer"] = "bearer"  # noqa: S105 - OAuth token type, not a secret
    expires_in: int
    user: UserOut


class MeUpdateIn(In):
    professional_mode: bool


# ------------------------------------------------------------------------------------------- vehicles


class VehicleOut(Out):
    id: uuid.UUID
    vin: str
    make: str | None
    model: str | None
    model_year: int | None
    display_name: str
    simulation: bool
    profile: dict[str, Any]
    profile_schema_version: str
    created_at: datetime
    last_connected_at: datetime | None
    last_scan_at: datetime | None


class SessionSummaryOut(Out):
    id: uuid.UUID
    kind: str
    status: str
    started_at: datetime
    finished_at: datetime | None
    duration_ms: int | None
    ecu_count: int
    dtc_count: int
    warnings: list[Any]
    error: dict[str, Any] | None


class VehicleDetailOut(BaseModel):
    vehicle: VehicleOut
    connected: bool
    gateway_vin: str | None
    interface: InterfaceStatus | None
    last_session: SessionSummaryOut | None
    ecu_count: int
    dtc_count: int
    active_dtc_count: int


class ConnectOut(BaseModel):
    vehicle: VehicleOut
    identity: VehicleIdentity
    interface: InterfaceStatus
    connection_id: uuid.UUID


# ------------------------------------------------------------------------------------------- scan


class DtcComparisonOut(BaseModel):
    appeared: list[str]
    resolved: list[str]
    status_changed: list[str]


class ScanOut(BaseModel):
    session_id: uuid.UUID
    schema_version: str
    vehicle: dict[str, Any]
    ecus: list[EcuInfo]
    dtcs: list[Dtc]
    warnings: list[str]
    duration_ms: int
    probed_addresses: int
    interface: InterfaceStatus
    comparison: DtcComparisonOut
    trace: list[dict[str, Any]] | None = None


class SessionDetailOut(SessionSummaryOut):
    vehicle_snapshot: dict[str, Any]
    interface: dict[str, Any]
    probed_addresses: int
    trace: list[Any] | None = None


class EcuOut(BaseModel):
    ecu: EcuInfo
    first_seen_at: datetime
    last_seen_at: datetime
    software_history: list[dict[str, Any]]


class DtcListOut(BaseModel):
    session_id: uuid.UUID | None
    read_at: datetime | None
    total: int
    dtcs: list[Dtc]
    groups: dict[str, list[Dtc]] | None = None


class DtcEventOut(Out):
    id: uuid.UUID
    ecu_key: str
    display: str
    event: str
    details: dict[str, Any]
    occurred_at: datetime
    session_id: uuid.UUID | None


class ClearDtcIn(In):
    ecu_id: str = Field(min_length=3, max_length=16, pattern=r"^0x[0-9A-Fa-f]{2,8}$")
    confirm: bool


class ClearDtcOut(BaseModel):
    result: ClearDtcResult
    audit_id: int


# ------------------------------------------------------------------------------------------- live data


class LiveParametersOut(BaseModel):
    vin: str
    parameters: list[LiveParameterDefinition]


class LiveReadIn(In):
    parameter_ids: list[str] = Field(min_length=1, max_length=64)


class SafetyCheckIn(In):
    operation: str = Field(min_length=1, max_length=64, pattern=r"^[a-z_]+$")
    risk: OperationRisk


class SafetyOut(BaseModel):
    decision: SafetyDecision


# ------------------------------------------------------------------------------------------- logs


class AuditOut(Out):
    id: int
    timestamp: datetime
    user_id: uuid.UUID
    vin: str | None
    ecu: str | None
    operation: str
    old_value: dict[str, Any] | None
    new_value: dict[str, Any] | None
    request: dict[str, Any]
    response: dict[str, Any] | None
    result: str
    error: dict[str, Any] | None
    software_version: str | None
    correlation_id: str | None


class OperationOut(Out):
    id: uuid.UUID
    operation: str
    status: str
    vehicle_id: uuid.UUID | None
    session_id: uuid.UUID | None
    ecu_key: str | None
    started_at: datetime
    finished_at: datetime | None
    duration_ms: int | None
    error: dict[str, Any] | None
    correlation_id: str | None


class GatewayStatusOut(BaseModel):
    reachable: bool
    interface: InterfaceStatus | None = None
    vin: str | None = None
    busy_with: str | None = None
    simulation: bool | None = None
    catalogs: list[dict[str, str]] = Field(default_factory=list)
    protocols: dict[str, str] = Field(default_factory=dict)
    error: dict[str, Any] | None = None
