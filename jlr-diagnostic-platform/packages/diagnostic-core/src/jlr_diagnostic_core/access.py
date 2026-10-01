"""Permission checks for security-sensitive UDS services, enforced at the transport boundary.

Every request PDU passes through :class:`GuardedTransport` before it reaches the vehicle, so no code
path — including future modules — can send a write, routine, reset, transfer or security-access
request without the caller holding the matching :class:`Permission`.

Security access: the platform never computes, guesses or brute-forces keys. A key can only come from
an authorised :class:`SecurityKeyProvider` (e.g. an OEM-sanctioned service); none ships with the
platform, so security access reports ``OEM_AUTH_REQUIRED``.
"""

from __future__ import annotations

from typing import Protocol

from jlr_protocols.uds import UdsClient, UdsTransport
from jlr_protocols.uds.constants import DiagnosticSessionType, Nrc, ServiceId
from jlr_shared_types.errors import (
    NegativeResponseError,
    PermissionDeniedError,
    SecurityAccessRequiredError,
)
from jlr_shared_types.permissions import Permission

SERVICE_PERMISSIONS: dict[int, Permission] = {
    ServiceId.CLEAR_DIAGNOSTIC_INFORMATION: Permission.DTC_CLEAR,
    ServiceId.ECU_RESET: Permission.UDS_ECU_RESET,
    ServiceId.READ_MEMORY_BY_ADDRESS: Permission.UDS_MEMORY_READ,
    ServiceId.SECURITY_ACCESS: Permission.UDS_SECURITY_ACCESS,
    ServiceId.COMMUNICATION_CONTROL: Permission.UDS_COMMUNICATION_CONTROL,
    ServiceId.WRITE_DATA_BY_IDENTIFIER: Permission.UDS_WRITE_DATA,
    ServiceId.ROUTINE_CONTROL: Permission.UDS_ROUTINE_CONTROL,
    ServiceId.REQUEST_DOWNLOAD: Permission.UDS_TRANSFER,
    ServiceId.REQUEST_UPLOAD: Permission.UDS_TRANSFER,
    ServiceId.TRANSFER_DATA: Permission.UDS_TRANSFER,
    ServiceId.REQUEST_TRANSFER_EXIT: Permission.UDS_TRANSFER,
}

READ_ONLY_PERMISSIONS: frozenset[Permission] = frozenset(
    {Permission.VEHICLE_READ, Permission.DIAGNOSTIC_SCAN, Permission.LIVE_DATA_READ}
)


def required_permission(payload: bytes) -> Permission | None:
    if not payload:
        return None
    sid = payload[0]
    if (
        sid == ServiceId.DIAGNOSTIC_SESSION_CONTROL
        and len(payload) > 1
        and (payload[1] & 0x7F) == DiagnosticSessionType.PROGRAMMING
    ):
        return Permission.UDS_TRANSFER
    return SERVICE_PERMISSIONS.get(sid)


class GuardedTransport:
    def __init__(self, inner: UdsTransport, permissions: frozenset[Permission]) -> None:
        self.inner = inner
        self.permissions = permissions

    @property
    def label(self) -> str:
        return self.inner.label

    async def send(self, payload: bytes) -> None:
        needed = required_permission(payload)
        if needed is not None and needed not in self.permissions:
            raise PermissionDeniedError(
                f"UDS service 0x{payload[0]:02X} requires permission {needed.value}",
                details={"service_id": payload[0], "permission": needed.value, "ecu": self.label},
            )
        await self.inner.send(payload)

    async def recv(self, timeout: float) -> bytes:
        return await self.inner.recv(timeout)


class SecurityKeyProvider(Protocol):
    """Authorised source of security-access keys (e.g. an OEM back-end). Not implemented by default."""

    async def compute_key(self, ecu_id: str, level: int, seed: bytes) -> bytes: ...


class SecurityAccessManager:
    """One attempt per level, stops on invalid key / attempt limit / delay; never iterates keys."""

    def __init__(self, provider: SecurityKeyProvider | None = None) -> None:
        self.provider = provider
        self._attempted: set[tuple[str, int]] = set()

    async def unlock(self, client: UdsClient, level: int) -> None:
        if self.provider is None:
            raise SecurityAccessRequiredError(
                "Security access requires an authorised key provider (OEM_AUTH_REQUIRED)",
                details={"ecu": client.label, "level": level},
            )
        key_id = (client.label, level)
        if key_id in self._attempted:
            raise SecurityAccessRequiredError(
                "Security access was already attempted for this ECU and level in this session; "
                "the platform does not retry",
                details={"ecu": client.label, "level": level},
            )
        self._attempted.add(key_id)
        seed = await client.security_access_request_seed(level)
        if not any(seed):  # all-zero seed: already unlocked
            return
        key = await self.provider.compute_key(client.label, level, seed)
        try:
            await client.security_access_send_key(level, key)
        except NegativeResponseError as exc:
            if exc.nrc in (
                Nrc.INVALID_KEY,
                Nrc.EXCEEDED_NUMBER_OF_ATTEMPTS,
                Nrc.REQUIRED_TIME_DELAY_NOT_EXPIRED,
            ):
                raise SecurityAccessRequiredError(
                    f"ECU refused the key ({exc.nrc_name}); not retrying",
                    details={"ecu": client.label, "level": level, "nrc": exc.nrc},
                ) from exc
            raise
