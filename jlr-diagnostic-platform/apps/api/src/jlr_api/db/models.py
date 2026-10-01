"""Persistence model (Milestone 1 scope).

Configuration, feature, backup and restore tables arrive with the milestones that implement those
engines (docs/ROADMAP.md); no table exists here without code that reads and writes it.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from jlr_api.db.base import Base, utcnow


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    telegram_id: Mapped[int] = mapped_column(BigInteger, unique=True)
    username: Mapped[str | None] = mapped_column(String(64))
    first_name: Mapped[str | None] = mapped_column(String(128))
    last_name: Mapped[str | None] = mapped_column(String(128))
    role: Mapped[str] = mapped_column(String(16), default="viewer")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    professional_mode: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Vehicle(Base):
    __tablename__ = "vehicles"
    __table_args__ = (UniqueConstraint("owner_id", "vin", name="uq_vehicles_owner_vin"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    owner_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"), index=True)
    vin: Mapped[str] = mapped_column(String(17), index=True)
    make: Mapped[str | None] = mapped_column(String(64))
    model: Mapped[str | None] = mapped_column(String(128))
    model_year: Mapped[int | None] = mapped_column(Integer)
    display_name: Mapped[str] = mapped_column(String(160))
    profile: Mapped[dict[str, Any]] = mapped_column(default=dict)
    profile_schema_version: Mapped[str] = mapped_column(String(32))
    simulation: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    last_connected_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_scan_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class VehicleConnection(Base):
    __tablename__ = "vehicle_connections"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicles.id", ondelete="CASCADE"), index=True)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    interface_kind: Mapped[str] = mapped_column(String(16))
    simulation: Mapped[bool] = mapped_column(Boolean, default=False)
    description: Mapped[str] = mapped_column(String(255), default="")
    vehicle_voltage: Mapped[float | None]
    identity: Mapped[dict[str, Any]] = mapped_column(default=dict)
    connected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DiagnosticSession(Base):
    __tablename__ = "diagnostic_sessions"
    __table_args__ = (Index("ix_diagnostic_sessions_vehicle_started", "vehicle_id", "started_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicles.id", ondelete="CASCADE"))
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    kind: Mapped[str] = mapped_column(String(32), default="full_scan")
    status: Mapped[str] = mapped_column(String(16), default="running")
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int | None]
    ecu_count: Mapped[int] = mapped_column(Integer, default=0)
    dtc_count: Mapped[int] = mapped_column(Integer, default=0)
    probed_addresses: Mapped[int] = mapped_column(Integer, default=0)
    warnings: Mapped[list[Any]] = mapped_column(default=list)
    interface: Mapped[dict[str, Any]] = mapped_column(default=dict)
    vehicle_snapshot: Mapped[dict[str, Any]] = mapped_column(default=dict)
    trace: Mapped[list[Any]] = mapped_column(default=list)
    result_schema_version: Mapped[str] = mapped_column(String(32))
    error: Mapped[dict[str, Any] | None] = mapped_column(nullable=True)
    correlation_id: Mapped[str | None] = mapped_column(String(64))


class ECU(Base):
    __tablename__ = "ecus"
    __table_args__ = (UniqueConstraint("vehicle_id", "ecu_key", name="uq_ecus_vehicle_key"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicles.id", ondelete="CASCADE"), index=True)
    ecu_key: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(128))
    name_source: Mapped[str] = mapped_column(String(32))
    request_address: Mapped[int] = mapped_column(Integer)
    response_address: Mapped[int] = mapped_column(Integer)
    protocol: Mapped[str] = mapped_column(String(64))
    capabilities: Mapped[dict[str, Any]] = mapped_column(default=dict)
    info: Mapped[dict[str, Any]] = mapped_column(default=dict)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    last_session_id: Mapped[uuid.UUID | None] = mapped_column(Uuid)

    software: Mapped[list[ECUSoftware]] = relationship(back_populates="ecu", cascade="all, delete-orphan")


class ECUSoftware(Base):
    """Identification snapshot per scan: hardware/software version history of an ECU."""

    __tablename__ = "ecu_software"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    ecu_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ecus.id", ondelete="CASCADE"), index=True)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("diagnostic_sessions.id", ondelete="CASCADE"))
    hardware_version: Mapped[str | None] = mapped_column(String(64))
    software_version: Mapped[str | None] = mapped_column(String(64))
    part_number: Mapped[str | None] = mapped_column(String(64))
    serial_number: Mapped[str | None] = mapped_column(String(64))
    identification: Mapped[list[Any]] = mapped_column(default=list)
    recorded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)

    ecu: Mapped[ECU] = relationship(back_populates="software")


class DTC(Base):
    __tablename__ = "dtcs"
    __table_args__ = (Index("ix_dtcs_session", "session_id"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("diagnostic_sessions.id", ondelete="CASCADE"))
    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicles.id", ondelete="CASCADE"), index=True)
    ecu_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("ecus.id", ondelete="CASCADE"))
    ecu_key: Mapped[str] = mapped_column(String(16))
    code: Mapped[str] = mapped_column(String(8))
    display: Mapped[str] = mapped_column(String(16))
    raw: Mapped[int] = mapped_column(Integer)
    status_byte: Mapped[int] = mapped_column(Integer)
    description: Mapped[str | None] = mapped_column(Text)
    description_source: Mapped[str] = mapped_column(String(32))
    severity: Mapped[str] = mapped_column(String(32))
    occurrence_count: Mapped[int | None]
    data: Mapped[dict[str, Any]] = mapped_column(default=dict)  # full versioned Dtc contract
    read_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class DTCEvent(Base):
    __tablename__ = "dtc_events"
    __table_args__ = (Index("ix_dtc_events_vehicle_time", "vehicle_id", "occurred_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicles.id", ondelete="CASCADE"))
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("diagnostic_sessions.id", ondelete="SET NULL")
    )
    ecu_key: Mapped[str] = mapped_column(String(16))
    display: Mapped[str] = mapped_column(String(16))
    event: Mapped[str] = mapped_column(String(24))  # APPEARED | RESOLVED | STATUS_CHANGED | CLEARED
    details: Mapped[dict[str, Any]] = mapped_column(default=dict)
    occurred_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class LiveParameter(Base):
    """A live parameter discovered on a vehicle (definition + evidence; samples are not stored)."""

    __tablename__ = "live_parameters"
    __table_args__ = (UniqueConstraint("vehicle_id", "parameter_key", name="uq_live_parameters_vehicle_key"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    vehicle_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("vehicles.id", ondelete="CASCADE"), index=True)
    parameter_key: Mapped[str] = mapped_column(String(48))
    ecu_key: Mapped[str] = mapped_column(String(16))
    name: Mapped[str] = mapped_column(String(128))
    unit: Mapped[str] = mapped_column(String(16))
    access: Mapped[str] = mapped_column(String(16))
    identifier: Mapped[int] = mapped_column(Integer)
    source: Mapped[str] = mapped_column(String(32))
    discovered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)


class DiagnosticOperation(Base):
    """Lifecycle record of every gateway operation (traceable by operation and correlation IDs)."""

    __tablename__ = "diagnostic_operations"
    __table_args__ = (Index("ix_diagnostic_operations_user_started", "user_id", "started_at"),)

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    vehicle_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("vehicles.id", ondelete="SET NULL"))
    session_id: Mapped[uuid.UUID | None] = mapped_column(
        ForeignKey("diagnostic_sessions.id", ondelete="SET NULL")
    )
    operation: Mapped[str] = mapped_column(String(48))
    ecu_key: Mapped[str | None] = mapped_column(String(16))
    status: Mapped[str] = mapped_column(String(16), default="running")
    request: Mapped[dict[str, Any]] = mapped_column(default=dict)
    response: Mapped[dict[str, Any] | None] = mapped_column(nullable=True)
    error: Mapped[dict[str, Any] | None] = mapped_column(nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    duration_ms: Mapped[int | None]
    correlation_id: Mapped[str | None] = mapped_column(String(64))


class AuditLog(Base):
    """Append-only record of every mutation. PostgreSQL rejects UPDATE/DELETE via trigger (migration)."""

    __tablename__ = "audit_logs"
    __table_args__ = (Index("ix_audit_logs_user_time", "user_id", "timestamp"),)

    id: Mapped[int] = mapped_column(
        BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
    )
    timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    telegram_id: Mapped[int] = mapped_column(BigInteger)
    vin: Mapped[str | None] = mapped_column(String(17))
    ecu: Mapped[str | None] = mapped_column(String(16))
    operation: Mapped[str] = mapped_column(String(48))
    old_value: Mapped[dict[str, Any] | None] = mapped_column(nullable=True)
    new_value: Mapped[dict[str, Any] | None] = mapped_column(nullable=True)
    request: Mapped[dict[str, Any]] = mapped_column(default=dict)
    response: Mapped[dict[str, Any] | None] = mapped_column(nullable=True)
    result: Mapped[str] = mapped_column(String(16))  # SUCCESS | FAILED | BLOCKED
    error: Mapped[dict[str, Any] | None] = mapped_column(nullable=True)
    software_version: Mapped[str | None] = mapped_column(String(64))
    correlation_id: Mapped[str | None] = mapped_column(String(64))
