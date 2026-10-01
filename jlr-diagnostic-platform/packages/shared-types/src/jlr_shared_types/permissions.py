"""Permissions checked before any diagnostic operation.

Read-only diagnostics, bus mutations and security-sensitive UDS services are separate permissions so
that a role can be allowed to scan without being allowed to clear DTCs, and nothing short of an
explicit grant can reach write/routine/transfer/security-access services.
"""

from __future__ import annotations

from enum import StrEnum


class Permission(StrEnum):
    VEHICLE_READ = "vehicle:read"
    VEHICLE_CONNECT = "vehicle:connect"
    DIAGNOSTIC_SCAN = "diagnostic:scan"
    LIVE_DATA_READ = "live_data:read"
    DTC_CLEAR = "dtc:clear"
    # Security-sensitive UDS services (ISO 14229-1). Not granted to any role in Milestone 1.
    UDS_WRITE_DATA = "uds:write_data"
    UDS_ROUTINE_CONTROL = "uds:routine_control"
    UDS_ECU_RESET = "uds:ecu_reset"
    UDS_COMMUNICATION_CONTROL = "uds:communication_control"
    UDS_SECURITY_ACCESS = "uds:security_access"
    UDS_MEMORY_READ = "uds:memory_read"
    UDS_TRANSFER = "uds:transfer"
    AUDIT_READ_ALL = "audit:read_all"


class Role(StrEnum):
    VIEWER = "viewer"
    TECHNICIAN = "technician"
    ADMIN = "admin"


ROLE_PERMISSIONS: dict[Role, frozenset[Permission]] = {
    Role.VIEWER: frozenset({Permission.VEHICLE_READ}),
    Role.TECHNICIAN: frozenset(
        {
            Permission.VEHICLE_READ,
            Permission.VEHICLE_CONNECT,
            Permission.DIAGNOSTIC_SCAN,
            Permission.LIVE_DATA_READ,
            Permission.DTC_CLEAR,
        }
    ),
    Role.ADMIN: frozenset(
        {
            Permission.VEHICLE_READ,
            Permission.VEHICLE_CONNECT,
            Permission.DIAGNOSTIC_SCAN,
            Permission.LIVE_DATA_READ,
            Permission.DTC_CLEAR,
            Permission.AUDIT_READ_ALL,
        }
    ),
}


def permissions_for(role: Role | str) -> frozenset[Permission]:
    try:
        return ROLE_PERMISSIONS[Role(role)]
    except ValueError:
        return frozenset()
