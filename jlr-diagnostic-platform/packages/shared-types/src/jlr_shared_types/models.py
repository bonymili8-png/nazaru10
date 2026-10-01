"""Versioned data contracts exchanged between the diagnostic gateway, the API and the Mini App.

Rule of the platform: nothing here *asserts* that a vehicle or ECU supports something. Every claim
about support is a :class:`Capability` with a :class:`CapabilityStatus` and the evidence it came from.
When there is no evidence the status is ``UNKNOWN``.
"""

from __future__ import annotations

from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

SCAN_RESULT_SCHEMA_VERSION = "scan-result/1"
VEHICLE_PROFILE_SCHEMA_VERSION = "vehicle-profile/1"
LIVE_DATA_SCHEMA_VERSION = "live-data/1"
GATEWAY_PROTOCOL_VERSION = "gateway-api/1"


class Contract(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")


# --------------------------------------------------------------------------------------------------
# Capability model
# --------------------------------------------------------------------------------------------------


class CapabilityStatus(StrEnum):
    SUPPORTED = "SUPPORTED"
    SUPPORTED_WITH_PREREQUISITES = "SUPPORTED_WITH_PREREQUISITES"
    HARDWARE_REQUIRED = "HARDWARE_REQUIRED"
    OEM_AUTH_REQUIRED = "OEM_AUTH_REQUIRED"
    UNKNOWN = "UNKNOWN"
    NOT_SUPPORTED = "NOT_SUPPORTED"


class EvidenceSource(StrEnum):
    """Where a fact came from. Ordered roughly from strongest to weakest."""

    ECU_RESPONSE = "ECU_RESPONSE"  # observed on the bus during this session
    ISO_STANDARD = "ISO_STANDARD"  # defined by ISO 14229 / ISO 15765 / SAE J1979 / SAE J2012
    USER_VERIFIED = "USER_VERIFIED"  # definition supplied and verified by the operator
    SIMULATION = "SIMULATION"  # defined by a simulator profile; not a statement about real vehicles
    HEURISTIC = "HEURISTIC"  # derived by a documented heuristic
    NONE = "NONE"  # no evidence


class Capability(Contract):
    status: CapabilityStatus = CapabilityStatus.UNKNOWN
    source: EvidenceSource = EvidenceSource.NONE
    evidence: str = "Not probed"
    prerequisites: list[str] = Field(default_factory=list)

    @classmethod
    def unknown(cls, evidence: str = "Not probed") -> Capability:
        return cls(status=CapabilityStatus.UNKNOWN, source=EvidenceSource.NONE, evidence=evidence)


class ECUCapabilities(Contract):
    read_dtc: Capability = Field(default_factory=Capability.unknown)
    clear_dtc: Capability = Field(default_factory=Capability.unknown)
    dtc_severity: Capability = Field(default_factory=Capability.unknown)
    freeze_frames: Capability = Field(default_factory=Capability.unknown)
    live_data: Capability = Field(default_factory=Capability.unknown)
    obd: Capability = Field(default_factory=Capability.unknown)
    extended_session: Capability = Field(default_factory=Capability.unknown)
    security_access: Capability = Field(default_factory=Capability.unknown)
    coding: Capability = Field(default_factory=Capability.unknown)
    adaptation: Capability = Field(default_factory=Capability.unknown)
    flashing: Capability = Field(default_factory=Capability.unknown)
    routines: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------------------------------
# Interface / connection
# --------------------------------------------------------------------------------------------------


class InterfaceKind(StrEnum):
    MOCK = "mock"
    CAN = "can"
    SOCKETCAN = "socketcan"
    DOIP = "doip"
    J2534 = "j2534"


class IgnitionState(StrEnum):
    ON = "ON"
    OFF = "OFF"
    UNKNOWN = "UNKNOWN"


class InterfaceStatus(Contract):
    kind: InterfaceKind
    connected: bool
    simulation: bool = False
    description: str = ""
    vehicle_voltage: float | None = None
    voltage_source: Literal["ADAPTER", "OBD_PID_42", "SIMULATION", "UNAVAILABLE"] = "UNAVAILABLE"
    ignition: IgnitionState = IgnitionState.UNKNOWN
    frames_sent: int = 0
    frames_received: int = 0
    errors: int = 0
    timeouts: int = 0
    last_error: str | None = None
    protocols: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------------------------------
# Vehicle identity
# --------------------------------------------------------------------------------------------------


class VinSource(Contract):
    ecu: str
    method: Literal["OBD_MODE_09_PID_02", "UDS_DID_F190", "DOIP_VEHICLE_ANNOUNCEMENT"]
    vin: str


class VehicleIdentity(Contract):
    vin: str | None
    vin_valid_format: bool = False
    vin_check_digit_valid: bool | None = None
    sources: list[VinSource] = Field(default_factory=list)
    consistent: bool = True
    warnings: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------------------------------
# ECU
# --------------------------------------------------------------------------------------------------


class IdentificationValue(Contract):
    did: int
    name: str
    status: Literal["READ", "NOT_SUPPORTED", "OEM_AUTH_REQUIRED", "TIMEOUT", "ERROR"]
    raw_hex: str | None = None
    text: str | None = None
    nrc: int | None = None


class EcuInfo(Contract):
    id: str  # stable within a vehicle: the physical request address, e.g. "0x7E0"
    name: str
    name_source: EvidenceSource
    request_address: int
    response_address: int
    protocol: str  # e.g. "UDS/ISO-TP/CAN-11bit", "UDS/DoIP"
    hardware_version: str | None = None
    software_version: str | None = None
    part_number: str | None = None
    serial_number: str | None = None
    vin: str | None = None
    responded_to: list[str] = Field(default_factory=list)
    identification: list[IdentificationValue] = Field(default_factory=list)
    capabilities: ECUCapabilities = Field(default_factory=ECUCapabilities)
    warnings: list[str] = Field(default_factory=list)


# --------------------------------------------------------------------------------------------------
# DTC
# --------------------------------------------------------------------------------------------------


class DtcStatusFlags(Contract):
    """ISO 14229-1 DTC status byte, bit by bit."""

    test_failed: bool
    test_failed_this_operation_cycle: bool
    pending: bool
    confirmed: bool
    test_not_completed_since_last_clear: bool
    test_failed_since_last_clear: bool
    test_not_completed_this_operation_cycle: bool
    warning_indicator_requested: bool


class DtcSeverity(StrEnum):
    CHECK_IMMEDIATELY = "CHECK_IMMEDIATELY"
    CHECK_AT_NEXT_HALT = "CHECK_AT_NEXT_HALT"
    MAINTENANCE_ONLY = "MAINTENANCE_ONLY"
    WARNING_INDICATOR = "WARNING_INDICATOR"
    NO_CLASS = "NO_CLASS"
    UNKNOWN = "UNKNOWN"


class FreezeFrameRecord(Contract):
    record_number: int
    raw_hex: str
    identifiers: list[dict[str, Any]] = Field(default_factory=list)
    decoded: bool = False
    note: str | None = None


class Dtc(Contract):
    ecu_id: str
    ecu_name: str
    code: str  # e.g. "P0300"
    display: str  # e.g. "P0300-00"
    raw: int  # 24-bit UDS DTC value (or 16-bit OBD value)
    failure_type: int | None
    failure_type_description: str | None = None
    status_byte: int
    status: DtcStatusFlags
    description: str | None
    description_source: EvidenceSource
    severity: DtcSeverity = DtcSeverity.UNKNOWN
    severity_source: EvidenceSource = EvidenceSource.NONE
    occurrence_count: int | None = None
    freeze_frames: list[FreezeFrameRecord] = Field(default_factory=list)
    extended_data_hex: str | None = None
    read_at: datetime


# --------------------------------------------------------------------------------------------------
# Live data
# --------------------------------------------------------------------------------------------------


class LiveParameterDefinition(Contract):
    id: str  # "<ecu_id>:obd:0C" or "<ecu_id>:did:DD01"
    ecu_id: str
    name: str
    unit: str
    access: Literal["OBD_MODE_01", "UDS_DID"]
    identifier: int
    source: EvidenceSource
    min_value: float | None = None
    max_value: float | None = None


class LiveParameterValue(Contract):
    id: str
    ecu_id: str
    name: str
    unit: str
    value: float | None
    raw_hex: str | None
    timestamp: datetime
    status: Literal["OK", "NOT_AVAILABLE", "TIMEOUT", "ERROR"] = "OK"
    error: str | None = None
    metadata: dict[str, Any] = Field(default_factory=dict)


class LiveDataSnapshot(Contract):
    schema_version: str = LIVE_DATA_SCHEMA_VERSION
    vin: str | None
    values: list[LiveParameterValue]
    duration_ms: int


# --------------------------------------------------------------------------------------------------
# Safety
# --------------------------------------------------------------------------------------------------


class OperationRisk(StrEnum):
    READ_ONLY = "READ_ONLY"
    LOW_RISK_WRITE = "LOW_RISK_WRITE"  # e.g. clear DTC
    CONFIGURATION_WRITE = "CONFIGURATION_WRITE"
    FLASHING = "FLASHING"


class SafetyVerdict(StrEnum):
    ALLOWED = "ALLOWED"
    ALLOWED_WITH_WARNINGS = "ALLOWED_WITH_WARNINGS"
    BLOCKED_NOT_CONNECTED = "BLOCKED_NOT_CONNECTED"
    BLOCKED_LOW_VOLTAGE = "BLOCKED_LOW_VOLTAGE"
    BLOCKED_HIGH_VOLTAGE = "BLOCKED_HIGH_VOLTAGE"
    BLOCKED_VOLTAGE_UNKNOWN = "BLOCKED_VOLTAGE_UNKNOWN"
    BLOCKED_UNSTABLE_CONNECTION = "BLOCKED_UNSTABLE_CONNECTION"
    BLOCKED_IGNITION_OFF = "BLOCKED_IGNITION_OFF"
    REQUIRES_OEM_AUTH = "REQUIRES_OEM_AUTH"


class SafetyDecision(Contract):
    operation: str
    risk: OperationRisk
    verdict: SafetyVerdict
    allowed: bool
    reasons: list[str] = Field(default_factory=list)
    vehicle_voltage: float | None = None
    ignition: IgnitionState = IgnitionState.UNKNOWN


# --------------------------------------------------------------------------------------------------
# Scan
# --------------------------------------------------------------------------------------------------


class ScanVehicle(Contract):
    vin: str | None
    identity: VehicleIdentity
    profile: dict[str, Any] = Field(default_factory=dict)


class ScanResult(Contract):
    schema_version: str = SCAN_RESULT_SCHEMA_VERSION
    vehicle: ScanVehicle
    ecus: list[EcuInfo]
    dtcs: list[Dtc]
    warnings: list[str]
    interface: InterfaceStatus
    started_at: datetime
    duration_ms: int
    probed_addresses: int = 0
    trace: list[dict[str, Any]] = Field(default_factory=list)


class ClearDtcResult(Contract):
    ecu_id: str
    cleared: bool
    dtcs_before: list[Dtc]
    dtcs_after: list[Dtc]
    safety: SafetyDecision
    duration_ms: int


class ConnectResult(Contract):
    interface: InterfaceStatus
    identity: VehicleIdentity
    profile: dict[str, Any] = Field(default_factory=dict)
