"""Live data: parameter discovery and reading.

Two sources, each with its own evidence:

* OBD-II Mode 01 (SAE J1979) — discovered per ECU from the standard supported-PID bitmaps.
* UDS DIDs — only those defined for that ECU in a loaded catalog (simulation or operator-verified),
  and only after the ECU answered a test read positively.
"""

from __future__ import annotations

import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from jlr_diagnostic_core.catalog import CatalogSet
from jlr_diagnostic_core.interface import DiagnosticAddress, DiagnosticInterface
from jlr_protocols import obd
from jlr_protocols.uds import UdsClient, UdsTiming
from jlr_protocols.uds.codec import check_response
from jlr_shared_types.errors import DiagnosticConnectionError, DiagnosticError, DiagnosticTimeoutError
from jlr_shared_types.models import EvidenceSource, LiveParameterDefinition, LiveParameterValue

ClientFactory = Callable[[DiagnosticAddress, UdsTiming | None], UdsClient]


def obd_parameter_id(ecu_id: str, pid: int) -> str:
    return f"{ecu_id}:obd:{pid:02X}"


def did_parameter_id(ecu_id: str, did: int) -> str:
    return f"{ecu_id}:did:{did:04X}"


@dataclass(frozen=True, slots=True)
class BoundParameter:
    definition: LiveParameterDefinition
    address: DiagnosticAddress


async def obd_supported_pids(client: UdsClient, first_response: bytes | None = None) -> set[int]:
    """Walk the supported-PID bitmaps (0x00, 0x20, ...) of one ECU."""

    supported: set[int] = set()
    for base in obd.SUPPORTED_PID_RANGES:
        if base and base not in supported:
            break
        if base == 0 and first_response is not None:
            response = first_response
        else:
            response = await client.request(obd.build_request(obd.ObdMode.CURRENT_DATA, base))
        data = obd.parse_mode01_response(response, [base])
        supported |= obd.parse_supported_pids(base, data[base])
    return supported


async def discover_parameters(
    interface: DiagnosticInterface,
    ecus: Sequence[tuple[str, DiagnosticAddress]],
    catalog: CatalogSet,
    client_factory: ClientFactory,
) -> tuple[list[BoundParameter], list[str]]:
    warnings: list[str] = []
    bound: list[BoundParameter] = []
    by_response = {address.response: (ecu_id, address) for ecu_id, address in ecus}

    # OBD: one functional request finds every emissions-relevant ECU.
    try:
        responses = await interface.functional_request(obd.build_request(obd.ObdMode.CURRENT_DATA, 0x00), 0.2)
    except DiagnosticConnectionError:
        raise
    except DiagnosticError as exc:
        responses = []
        warnings.append(f"OBD-II functional request failed: {exc.message}")
    for address, first in responses:
        ecu_id, ecu_address = by_response.get(address.response, (address.id, address))
        try:
            check_response(obd.ObdMode.CURRENT_DATA, first)
            pids = await obd_supported_pids(client_factory(ecu_address, None), first)
        except DiagnosticConnectionError:
            raise
        except DiagnosticError as exc:
            warnings.append(f"{ecu_id}: OBD-II supported PIDs unreadable ({exc.message})")
            continue
        for pid in sorted(pids & obd.PIDS.keys()):
            spec = obd.PIDS[pid]
            bound.append(
                BoundParameter(
                    LiveParameterDefinition(
                        id=obd_parameter_id(ecu_id, pid),
                        ecu_id=ecu_id,
                        name=spec.name,
                        unit=spec.unit,
                        access="OBD_MODE_01",
                        identifier=pid,
                        source=EvidenceSource.ISO_STANDARD,
                        min_value=spec.min_value,
                        max_value=spec.max_value,
                    ),
                    ecu_address,
                )
            )

    # UDS DIDs from catalogs, confirmed by a test read.
    for ecu_id, address in ecus:
        definitions = catalog.did_parameters(address.request)
        if not definitions:
            continue
        client = client_factory(address, None)
        for parameter, source in definitions:
            try:
                parameter.decode(await client.read_data_by_identifier(parameter.did))
            except DiagnosticConnectionError:
                raise
            except (DiagnosticError, ValueError):
                continue
            bound.append(
                BoundParameter(
                    LiveParameterDefinition(
                        id=did_parameter_id(ecu_id, parameter.did),
                        ecu_id=ecu_id,
                        name=parameter.name,
                        unit=parameter.unit,
                        access="UDS_DID",
                        identifier=parameter.did,
                        source=source,
                        min_value=parameter.min_value,
                        max_value=parameter.max_value,
                    ),
                    address,
                )
            )
    return bound, warnings


async def read_parameters(
    parameters: Sequence[BoundParameter], catalog: CatalogSet, client_factory: ClientFactory
) -> list[LiveParameterValue]:
    """Read values; OBD PIDs of one ECU are batched (up to 6 per request, SAE J1979)."""

    values: dict[str, LiveParameterValue] = {}
    obd_groups: dict[DiagnosticAddress, list[BoundParameter]] = {}
    for p in parameters:
        if p.definition.access == "OBD_MODE_01":
            obd_groups.setdefault(p.address, []).append(p)

    def failed(p: BoundParameter, status: str, error: str) -> LiveParameterValue:
        d = p.definition
        return LiveParameterValue(
            id=d.id,
            ecu_id=d.ecu_id,
            name=d.name,
            unit=d.unit,
            value=None,
            raw_hex=None,
            timestamp=datetime.now(UTC),
            status=status,
            error=error,
        )

    for address, group in obd_groups.items():
        client = client_factory(address, None)
        for start in range(0, len(group), 6):
            chunk = group[start : start + 6]
            pids = [p.definition.identifier for p in chunk]
            started = time.monotonic()
            try:
                response = await client.request(obd.build_request(obd.ObdMode.CURRENT_DATA, *pids))
                data = obd.parse_mode01_response(response, pids)
            except DiagnosticConnectionError:
                raise
            except DiagnosticTimeoutError as exc:
                for p in chunk:
                    values[p.definition.id] = failed(p, "TIMEOUT", exc.message)
                continue
            except DiagnosticError as exc:
                for p in chunk:
                    values[p.definition.id] = failed(p, "ERROR", exc.message)
                continue
            latency = round((time.monotonic() - started) * 1000, 2)
            for p in chunk:
                d = p.definition
                raw = data.get(d.identifier)
                if raw is None:
                    values[d.id] = failed(p, "NOT_AVAILABLE", "PID missing from response")
                    continue
                values[d.id] = LiveParameterValue(
                    id=d.id,
                    ecu_id=d.ecu_id,
                    name=d.name,
                    unit=d.unit,
                    value=round(obd.PIDS[d.identifier].decode(raw), 3),
                    raw_hex=raw.hex().upper(),
                    timestamp=datetime.now(UTC),
                    metadata={"access": "OBD_MODE_01", "pid": f"0x{d.identifier:02X}", "latency_ms": latency},
                )

    for p in parameters:
        d = p.definition
        if d.access != "UDS_DID":
            continue
        found = catalog.did_parameter(p.address.request, d.identifier)
        if found is None:
            values[d.id] = failed(p, "NOT_AVAILABLE", "Definition no longer loaded")
            continue
        parameter, _ = found
        started = time.monotonic()
        try:
            raw = await client_factory(p.address, None).read_data_by_identifier(d.identifier)
            value = parameter.decode(raw)
        except DiagnosticConnectionError:
            raise
        except DiagnosticTimeoutError as exc:
            values[d.id] = failed(p, "TIMEOUT", exc.message)
            continue
        except (DiagnosticError, ValueError) as exc:
            values[d.id] = failed(p, "ERROR", str(exc))
            continue
        values[d.id] = LiveParameterValue(
            id=d.id,
            ecu_id=d.ecu_id,
            name=d.name,
            unit=d.unit,
            value=round(value, 3),
            raw_hex=raw.hex().upper(),
            timestamp=datetime.now(UTC),
            metadata={
                "access": "UDS_DID",
                "did": f"0x{d.identifier:04X}",
                "latency_ms": round((time.monotonic() - started) * 1000, 2),
            },
        )
    return [values[p.definition.id] for p in parameters if p.definition.id in values]
