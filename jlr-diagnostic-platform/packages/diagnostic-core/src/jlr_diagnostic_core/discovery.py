"""ECU discovery and identification.

Discovery never assumes an ECU list. It:

1. listens passively and excludes every identifier already in use on the bus,
2. probes candidate request addresses with TesterPresent (any reply — positive or negative — proves
   an ECU), in ascending order with bounded concurrency so the bus is never flooded,
3. excludes the response identifier of every ECU it finds from later probes.

Identification reads the ISO 14229-1 identification DIDs one by one; each DID's outcome is kept
(READ / NOT_SUPPORTED / OEM_AUTH_REQUIRED / TIMEOUT) as evidence.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from dataclasses import dataclass, field

from jlr_diagnostic_core.interface import DiagnosticAddress, DiagnosticInterface
from jlr_protocols.uds import UdsClient, UdsTiming
from jlr_protocols.uds.constants import Nrc, StandardDid
from jlr_shared_types.errors import (
    DiagnosticConnectionError,
    DiagnosticError,
    DiagnosticTimeoutError,
    NegativeResponseError,
    ProtocolError,
)
from jlr_shared_types.models import IdentificationValue

ClientFactory = Callable[[DiagnosticAddress, UdsTiming | None], UdsClient]


@dataclass(frozen=True, slots=True)
class DiscoveryConfig:
    probe_timeout: float = 0.05
    concurrency: int = 4
    passive_listen: float = 0.2

    def __post_init__(self) -> None:
        if not 1 <= self.concurrency <= 8:
            raise ValueError("Discovery concurrency must be between 1 and 8 to protect the vehicle bus")


@dataclass(slots=True)
class DiscoveryResult:
    found: list[DiagnosticAddress] = field(default_factory=list)
    probed: int = 0
    skipped_in_use: list[int] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


async def discover_ecus(
    interface: DiagnosticInterface, config: DiscoveryConfig, client_factory: ClientFactory
) -> DiscoveryResult:
    result = DiscoveryResult()
    in_use = await interface.passive_listen(config.passive_listen)
    excluded: set[int] = set(in_use)
    candidates = list(interface.candidate_addresses())
    timing = UdsTiming(p2=config.probe_timeout, p2_star=1.0, max_response_pending=3)

    async def probe(address: DiagnosticAddress) -> tuple[DiagnosticAddress, bool, str | None]:
        client = client_factory(address, timing)
        try:
            await client.tester_present()
            return address, True, None
        except NegativeResponseError:
            return address, True, None  # an ECU answered, even if it rejects TesterPresent
        except DiagnosticTimeoutError:
            return address, False, None
        except ProtocolError as exc:
            return address, True, f"{address.id}: responded with malformed data ({exc.message})"

    index = 0
    while index < len(candidates):
        batch: list[DiagnosticAddress] = []
        while index < len(candidates) and len(batch) < config.concurrency:
            address = candidates[index]
            index += 1
            if address.request in excluded:
                if address.request in in_use:
                    result.skipped_in_use.append(address.request)
                continue
            batch.append(address)
        if not batch:
            continue
        outcomes = await asyncio.gather(*(probe(a) for a in batch), return_exceptions=True)
        result.probed += len(batch)
        for outcome in outcomes:
            if isinstance(outcome, DiagnosticConnectionError):
                raise outcome
            if isinstance(outcome, BaseException):
                raise outcome
            address, present, warning = outcome
            if warning:
                result.warnings.append(warning)
            if present:
                result.found.append(address)
                excluded.add(address.response)
            else:
                release = getattr(interface, "release", None)
                if callable(release):
                    release(address)
    if result.skipped_in_use:
        result.warnings.append(
            "Skipped probing identifiers already in use on the bus: "
            + ", ".join(f"0x{i:X}" for i in sorted(set(result.skipped_in_use)))
        )
    return result


# --------------------------------------------------------------------------------------------------
# Identification
# --------------------------------------------------------------------------------------------------

IDENTIFICATION_DIDS: tuple[tuple[StandardDid, str], ...] = (
    (StandardDid.SYSTEM_NAME_OR_ENGINE_TYPE, "System name / engine type"),
    (StandardDid.VIN, "VIN"),
    (StandardDid.VEHICLE_MANUFACTURER_SPARE_PART_NUMBER, "Spare part number"),
    (StandardDid.VEHICLE_MANUFACTURER_ECU_HARDWARE_NUMBER, "Manufacturer hardware number"),
    (StandardDid.SYSTEM_SUPPLIER_ECU_HARDWARE_VERSION_NUMBER, "Supplier hardware version"),
    (StandardDid.VEHICLE_MANUFACTURER_ECU_SOFTWARE_NUMBER, "Manufacturer software number"),
    (StandardDid.SYSTEM_SUPPLIER_ECU_SOFTWARE_VERSION_NUMBER, "Supplier software version"),
    (StandardDid.SYSTEM_SUPPLIER_IDENTIFIER, "System supplier"),
    (StandardDid.ECU_SERIAL_NUMBER, "ECU serial number"),
)


def decode_identification(data: bytes) -> tuple[str, str | None]:
    """(hex, text) — text only when the payload is printable ASCII after trimming padding."""

    trimmed = data.rstrip(b"\x00\xff ").lstrip(b"\x00 ")
    text = None
    if trimmed and all(0x20 <= b < 0x7F for b in trimmed):
        text = trimmed.decode("ascii")
    return data.hex().upper(), text


async def read_identification(
    client: UdsClient, max_consecutive_timeouts: int = 2
) -> list[IdentificationValue]:
    values: list[IdentificationValue] = []
    timeouts = 0
    for did, name in IDENTIFICATION_DIDS:
        if timeouts >= max_consecutive_timeouts:
            values.append(IdentificationValue(did=did, name=name, status="TIMEOUT"))
            continue
        try:
            data = await client.read_data_by_identifier(did)
            raw_hex, text = decode_identification(data)
            values.append(IdentificationValue(did=did, name=name, status="READ", raw_hex=raw_hex, text=text))
            timeouts = 0
        except NegativeResponseError as exc:
            status = (
                "OEM_AUTH_REQUIRED"
                if exc.nrc in (Nrc.SECURITY_ACCESS_DENIED, Nrc.AUTHENTICATION_REQUIRED)
                else "NOT_SUPPORTED"
                if exc.nrc
                in (Nrc.REQUEST_OUT_OF_RANGE, Nrc.SERVICE_NOT_SUPPORTED, Nrc.SUB_FUNCTION_NOT_SUPPORTED)
                else "ERROR"
            )
            values.append(IdentificationValue(did=did, name=name, status=status, nrc=exc.nrc))
        except DiagnosticTimeoutError:
            timeouts += 1
            values.append(IdentificationValue(did=did, name=name, status="TIMEOUT"))
        except DiagnosticConnectionError:
            raise
        except DiagnosticError:
            values.append(IdentificationValue(did=did, name=name, status="ERROR"))
    return values


def identification_text(values: list[IdentificationValue], *dids: int) -> str | None:
    by_did = {v.did: v for v in values if v.status == "READ"}
    for did in dids:
        value = by_did.get(did)
        if value is not None:
            return value.text or value.raw_hex
    return None
