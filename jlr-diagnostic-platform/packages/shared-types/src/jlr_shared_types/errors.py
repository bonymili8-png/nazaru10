"""Typed error model shared by the protocol stack, the gateway and the API.

Every error carries a stable machine-readable :class:`ErrorCode` so that an error raised deep in the
protocol stack inside the gateway can cross the HTTP boundary and be reconstructed as the same type
in the API (see :func:`error_from_payload`).

Names deliberately avoid shadowing Python built-ins (``ConnectionError``, ``TimeoutError``): the
specification's ``ConnectionError`` is :class:`DiagnosticConnectionError` and ``TimeoutError`` is
:class:`DiagnosticTimeoutError`.
"""

from __future__ import annotations

from enum import StrEnum
from typing import Any, ClassVar


class ErrorCode(StrEnum):
    CONNECTION_ERROR = "CONNECTION_ERROR"
    NOT_CONNECTED = "NOT_CONNECTED"
    PROTOCOL_ERROR = "PROTOCOL_ERROR"
    NEGATIVE_RESPONSE = "NEGATIVE_RESPONSE"
    TIMEOUT = "TIMEOUT"
    ECU_NOT_FOUND = "ECU_NOT_FOUND"
    UNSUPPORTED_OPERATION = "UNSUPPORTED_OPERATION"
    SECURITY_ACCESS_REQUIRED = "SECURITY_ACCESS_REQUIRED"
    COMPATIBILITY_ERROR = "COMPATIBILITY_ERROR"
    VIN_MISMATCH = "VIN_MISMATCH"
    LOW_VOLTAGE = "LOW_VOLTAGE"
    SAFETY_BLOCKED = "SAFETY_BLOCKED"
    BACKUP_REQUIRED = "BACKUP_REQUIRED"
    VERIFICATION_FAILED = "VERIFICATION_FAILED"
    PERMISSION_DENIED = "PERMISSION_DENIED"
    CONFIRMATION_REQUIRED = "CONFIRMATION_REQUIRED"
    OPERATION_IN_PROGRESS = "OPERATION_IN_PROGRESS"
    # API-level codes
    AUTH_REQUIRED = "AUTH_REQUIRED"
    NOT_FOUND = "NOT_FOUND"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    RATE_LIMITED = "RATE_LIMITED"
    GATEWAY_UNAVAILABLE = "GATEWAY_UNAVAILABLE"
    INTERNAL_ERROR = "INTERNAL_ERROR"


_HTTP_STATUS: dict[ErrorCode, int] = {
    ErrorCode.CONNECTION_ERROR: 503,
    ErrorCode.NOT_CONNECTED: 409,
    ErrorCode.PROTOCOL_ERROR: 502,
    ErrorCode.NEGATIVE_RESPONSE: 502,
    ErrorCode.TIMEOUT: 504,
    ErrorCode.ECU_NOT_FOUND: 404,
    ErrorCode.UNSUPPORTED_OPERATION: 422,
    ErrorCode.SECURITY_ACCESS_REQUIRED: 403,
    ErrorCode.COMPATIBILITY_ERROR: 409,
    ErrorCode.VIN_MISMATCH: 409,
    ErrorCode.LOW_VOLTAGE: 409,
    ErrorCode.SAFETY_BLOCKED: 409,
    ErrorCode.BACKUP_REQUIRED: 409,
    ErrorCode.VERIFICATION_FAILED: 500,
    ErrorCode.PERMISSION_DENIED: 403,
    ErrorCode.CONFIRMATION_REQUIRED: 428,
    ErrorCode.OPERATION_IN_PROGRESS: 409,
    ErrorCode.AUTH_REQUIRED: 401,
    ErrorCode.NOT_FOUND: 404,
    ErrorCode.VALIDATION_ERROR: 422,
    ErrorCode.RATE_LIMITED: 429,
    ErrorCode.GATEWAY_UNAVAILABLE: 503,
    ErrorCode.INTERNAL_ERROR: 500,
}


def http_status_for(code: ErrorCode) -> int:
    return _HTTP_STATUS.get(code, 500)


class DiagnosticError(Exception):
    """Base class of every error the platform raises on purpose."""

    code: ClassVar[ErrorCode] = ErrorCode.INTERNAL_ERROR

    def __init__(self, message: str, *, details: dict[str, Any] | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.details: dict[str, Any] = details or {}

    def to_payload(self) -> dict[str, Any]:
        return {"code": self.code.value, "message": self.message, "details": self.details}

    def __repr__(self) -> str:
        return f"{type(self).__name__}({self.message!r}, details={self.details!r})"


class DiagnosticConnectionError(DiagnosticError):
    """Interface or vehicle link failure (the specification's ``ConnectionError``)."""

    code = ErrorCode.CONNECTION_ERROR


class NotConnectedError(DiagnosticConnectionError):
    code = ErrorCode.NOT_CONNECTED


class ProtocolError(DiagnosticError):
    """Malformed, unexpected or out-of-sequence protocol data."""

    code = ErrorCode.PROTOCOL_ERROR


class NegativeResponseError(ProtocolError):
    """A UDS/OBD negative response (``0x7F``) that the caller has to handle."""

    code = ErrorCode.NEGATIVE_RESPONSE

    def __init__(self, service_id: int, nrc: int, nrc_name: str, *, ecu: str | None = None) -> None:
        super().__init__(
            f"ECU {ecu or '?'} rejected service 0x{service_id:02X}: NRC 0x{nrc:02X} ({nrc_name})",
            details={"service_id": service_id, "nrc": nrc, "nrc_name": nrc_name, "ecu": ecu},
        )
        self.service_id = service_id
        self.nrc = nrc
        self.nrc_name = nrc_name


class DiagnosticTimeoutError(DiagnosticError):
    """No (complete) response within the protocol timing budget (the specification's ``TimeoutError``)."""

    code = ErrorCode.TIMEOUT


class ECUNotFoundError(DiagnosticError):
    code = ErrorCode.ECU_NOT_FOUND


class UnsupportedOperationError(DiagnosticError):
    code = ErrorCode.UNSUPPORTED_OPERATION


class SecurityAccessRequiredError(DiagnosticError):
    """The ECU requires security access / OEM authentication the platform does not hold."""

    code = ErrorCode.SECURITY_ACCESS_REQUIRED


class CompatibilityError(DiagnosticError):
    code = ErrorCode.COMPATIBILITY_ERROR


class VinMismatchError(CompatibilityError):
    code = ErrorCode.VIN_MISMATCH


class LowVoltageError(DiagnosticError):
    code = ErrorCode.LOW_VOLTAGE


class SafetyBlockedError(DiagnosticError):
    code = ErrorCode.SAFETY_BLOCKED


class BackupRequiredError(DiagnosticError):
    code = ErrorCode.BACKUP_REQUIRED


class VerificationError(DiagnosticError):
    code = ErrorCode.VERIFICATION_FAILED


class PermissionDeniedError(DiagnosticError):
    code = ErrorCode.PERMISSION_DENIED


class ConfirmationRequiredError(DiagnosticError):
    code = ErrorCode.CONFIRMATION_REQUIRED


class OperationInProgressError(DiagnosticError):
    code = ErrorCode.OPERATION_IN_PROGRESS


class AuthRequiredError(DiagnosticError):
    code = ErrorCode.AUTH_REQUIRED


class NotFoundError(DiagnosticError):
    code = ErrorCode.NOT_FOUND


class RateLimitedError(DiagnosticError):
    code = ErrorCode.RATE_LIMITED


class GatewayUnavailableError(DiagnosticError):
    code = ErrorCode.GATEWAY_UNAVAILABLE


_BY_CODE: dict[ErrorCode, type[DiagnosticError]] = {
    cls.code: cls
    for cls in (
        DiagnosticError,
        DiagnosticConnectionError,
        NotConnectedError,
        ProtocolError,
        DiagnosticTimeoutError,
        ECUNotFoundError,
        UnsupportedOperationError,
        SecurityAccessRequiredError,
        CompatibilityError,
        VinMismatchError,
        LowVoltageError,
        SafetyBlockedError,
        BackupRequiredError,
        VerificationError,
        PermissionDeniedError,
        ConfirmationRequiredError,
        OperationInProgressError,
        AuthRequiredError,
        NotFoundError,
        RateLimitedError,
        GatewayUnavailableError,
    )
}


def error_from_payload(payload: dict[str, Any]) -> DiagnosticError:
    """Rebuild a typed error from its ``to_payload()`` form (e.g. a gateway HTTP error body)."""

    try:
        code = ErrorCode(payload.get("code", ErrorCode.INTERNAL_ERROR))
    except ValueError:
        code = ErrorCode.INTERNAL_ERROR
    message = str(payload.get("message", "Unknown error"))
    details = payload.get("details") or {}
    if code is ErrorCode.NEGATIVE_RESPONSE:
        return NegativeResponseError(
            int(details.get("service_id", 0)),
            int(details.get("nrc", 0)),
            str(details.get("nrc_name", "unknown")),
            ecu=details.get("ecu"),
        )
    cls = _BY_CODE.get(code, DiagnosticError)
    return cls(message, details=dict(details))
