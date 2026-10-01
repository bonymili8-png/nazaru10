"""Capability classification from observed ECU behaviour.

The mapping from a probe's outcome to a :class:`CapabilityStatus` is the single source of truth for
"does this ECU support X". Absence of evidence is UNKNOWN; only an explicit negative response
classifies something as NOT_SUPPORTED.
"""

from __future__ import annotations

from jlr_protocols.uds.constants import Nrc
from jlr_shared_types.errors import (
    DiagnosticError,
    DiagnosticTimeoutError,
    NegativeResponseError,
    SecurityAccessRequiredError,
)
from jlr_shared_types.models import Capability, CapabilityStatus, EvidenceSource

_NOT_SUPPORTED = {
    Nrc.SERVICE_NOT_SUPPORTED,
    Nrc.SUB_FUNCTION_NOT_SUPPORTED,
    Nrc.REQUEST_OUT_OF_RANGE,
}
_NEEDS_SESSION = {
    Nrc.SERVICE_NOT_SUPPORTED_IN_ACTIVE_SESSION,
    Nrc.SUB_FUNCTION_NOT_SUPPORTED_IN_ACTIVE_SESSION,
}
_NEEDS_CONDITIONS = {
    Nrc.CONDITIONS_NOT_CORRECT,
    Nrc.REQUEST_SEQUENCE_ERROR,
    Nrc.BUSY_REPEAT_REQUEST,
    Nrc.VOLTAGE_TOO_LOW,
    Nrc.VOLTAGE_TOO_HIGH,
}
_NEEDS_AUTH = {Nrc.SECURITY_ACCESS_DENIED, Nrc.AUTHENTICATION_REQUIRED}


def capability_from_error(exc: Exception, probe: str) -> Capability:
    if isinstance(exc, NegativeResponseError):
        evidence = f"{probe}: NRC 0x{exc.nrc:02X} ({exc.nrc_name})"
        if exc.nrc in _NOT_SUPPORTED:
            return Capability(
                status=CapabilityStatus.NOT_SUPPORTED, source=EvidenceSource.ECU_RESPONSE, evidence=evidence
            )
        if exc.nrc in _NEEDS_SESSION:
            return Capability(
                status=CapabilityStatus.SUPPORTED_WITH_PREREQUISITES,
                source=EvidenceSource.ECU_RESPONSE,
                evidence=evidence,
                prerequisites=["Different diagnostic session"],
            )
        if exc.nrc in _NEEDS_CONDITIONS:
            return Capability(
                status=CapabilityStatus.SUPPORTED_WITH_PREREQUISITES,
                source=EvidenceSource.ECU_RESPONSE,
                evidence=evidence,
                prerequisites=["Vehicle conditions (ignition, voltage, speed, ...) as required by the ECU"],
            )
        if exc.nrc in _NEEDS_AUTH:
            return Capability(
                status=CapabilityStatus.OEM_AUTH_REQUIRED,
                source=EvidenceSource.ECU_RESPONSE,
                evidence=evidence,
            )
        return Capability(
            status=CapabilityStatus.UNKNOWN, source=EvidenceSource.ECU_RESPONSE, evidence=evidence
        )
    if isinstance(exc, SecurityAccessRequiredError):
        return Capability(
            status=CapabilityStatus.OEM_AUTH_REQUIRED, source=EvidenceSource.NONE, evidence=exc.message
        )
    if isinstance(exc, DiagnosticTimeoutError):
        return Capability.unknown(f"{probe}: no response (timeout)")
    if isinstance(exc, DiagnosticError):
        return Capability.unknown(f"{probe}: {exc.message}")
    return Capability.unknown(f"{probe}: {exc}")


def supported(evidence: str) -> Capability:
    return Capability(
        status=CapabilityStatus.SUPPORTED, source=EvidenceSource.ECU_RESPONSE, evidence=evidence
    )


NOT_PROBED_MUTATION = Capability.unknown(
    "Not probed: probing would modify ECU state. Status is established only from a verified definition "
    "or an operator-confirmed operation."
)
NOT_PROBED_MILESTONE = Capability.unknown("Not probed by the Milestone 1 scanner")
