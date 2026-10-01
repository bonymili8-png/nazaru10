"""DiagnosticService — the application-facing diagnostic engine.

connect -> identify vehicle -> discover ECUs -> identify ECUs -> read DTCs -> detect capabilities.

One service owns one vehicle connection. Operations are serialised by a lock: the vehicle bus is a
shared, fragile medium and concurrency is only used *inside* an operation, bounded by configuration.
"""

from __future__ import annotations

import asyncio
import time
from collections import Counter
from collections.abc import AsyncIterator, Sequence
from contextlib import asynccontextmanager
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Any

from jlr_diagnostic_core.access import READ_ONLY_PERMISSIONS, GuardedTransport
from jlr_diagnostic_core.capabilities import NOT_PROBED_MILESTONE, NOT_PROBED_MUTATION, supported
from jlr_diagnostic_core.catalog import CatalogSet
from jlr_diagnostic_core.discovery import (
    DiscoveryConfig,
    discover_ecus,
    identification_text,
    read_identification,
)
from jlr_diagnostic_core.dtc import EcuDtcReadout, read_ecu_dtcs
from jlr_diagnostic_core.interface import DiagnosticAddress, DiagnosticInterface, EcuTransport
from jlr_diagnostic_core.live_data import BoundParameter, discover_parameters, read_parameters
from jlr_diagnostic_core.observability import TraceCollector, operation_scope, trace_hook
from jlr_diagnostic_core.safety import VehicleSafetyChecker
from jlr_protocols import obd
from jlr_protocols.uds import UdsClient, UdsTiming
from jlr_protocols.uds.codec import parse_read_data_by_identifier
from jlr_protocols.uds.constants import StandardDid
from jlr_shared_types.errors import (
    ConfirmationRequiredError,
    DiagnosticConnectionError,
    DiagnosticError,
    ECUNotFoundError,
    LowVoltageError,
    NotConnectedError,
    OperationInProgressError,
    PermissionDeniedError,
    SafetyBlockedError,
    UnsupportedOperationError,
    VinMismatchError,
)
from jlr_shared_types.models import (
    Capability,
    CapabilityStatus,
    ClearDtcResult,
    ConnectResult,
    Dtc,
    ECUCapabilities,
    EcuInfo,
    EvidenceSource,
    IdentificationValue,
    InterfaceStatus,
    LiveDataSnapshot,
    LiveParameterDefinition,
    OperationRisk,
    SafetyDecision,
    SafetyVerdict,
    ScanResult,
    ScanVehicle,
    VehicleIdentity,
    VinSource,
)
from jlr_shared_types.permissions import Permission
from jlr_vehicle_model import build_profile, check_digit_valid, is_valid_format, normalize_vin


@dataclass(frozen=True, slots=True)
class ServiceConfig:
    discovery: DiscoveryConfig = field(default_factory=DiscoveryConfig)
    timing: UdsTiming = field(default_factory=UdsTiming)
    functional_timeout: float = 0.25
    scan_concurrency: int = 2
    dtc_details_limit: int = 20
    trace: bool = True

    def __post_init__(self) -> None:
        if not 1 <= self.scan_concurrency <= 4:
            raise ValueError("scan_concurrency must be between 1 and 4")


@dataclass(slots=True)
class _KnownEcu:
    address: DiagnosticAddress
    info: EcuInfo


class DiagnosticService:
    def __init__(
        self,
        interface: DiagnosticInterface,
        *,
        catalog: CatalogSet | None = None,
        config: ServiceConfig | None = None,
        safety: VehicleSafetyChecker | None = None,
        profile_overrides: dict[str, Any] | None = None,
    ) -> None:
        self.interface = interface
        self.catalog = catalog or CatalogSet()
        self.config = config or ServiceConfig()
        self.safety = safety or VehicleSafetyChecker()
        self.profile_overrides = profile_overrides or {}
        self.identity: VehicleIdentity | None = None
        self.ecus: dict[str, _KnownEcu] = {}
        self.parameters: dict[str, BoundParameter] = {}
        self.last_scan: ScanResult | None = None
        self.link_failures = 0
        self._lock = asyncio.Lock()
        self._current: str | None = None
        self._connected = False
        self._obd_voltage: tuple[DiagnosticAddress, str] | None = None

    # ------------------------------------------------------------------ plumbing

    @asynccontextmanager
    async def _exclusive(self, name: str, wait: float = 0.0) -> AsyncIterator[None]:
        try:
            async with asyncio.timeout(wait or None):
                if wait == 0 and self._lock.locked():
                    raise TimeoutError
                await self._lock.acquire()
        except TimeoutError as exc:
            raise OperationInProgressError(
                f"Vehicle bus busy with '{self._current}'", details={"operation": self._current}
            ) from exc
        self._current = name
        try:
            yield
        finally:
            self._current = None
            self._lock.release()

    def _client(
        self,
        address: DiagnosticAddress,
        timing: UdsTiming | None = None,
        permissions: frozenset[Permission] = READ_ONLY_PERMISSIONS,
    ) -> UdsClient:
        transport = GuardedTransport(EcuTransport(self.interface, address), permissions)
        return UdsClient(transport, timing or self.config.timing, trace_hook if self.config.trace else None)

    def _read_client_factory(self, address: DiagnosticAddress, timing: UdsTiming | None) -> UdsClient:
        return self._client(address, timing)

    def _profile(self, vin: str | None) -> dict[str, Any]:
        if not vin or not is_valid_format(vin):
            return {}
        return build_profile(vin, overrides=self.profile_overrides).model_dump(mode="json")

    @property
    def busy_with(self) -> str | None:
        return self._current

    # ------------------------------------------------------------------ connection

    async def connect(self) -> ConnectResult:
        async with self._exclusive("connect", wait=5.0), operation_scope("connect"):
            await self.interface.connect()
            self._connected = True
            self.link_failures = 0
            self.ecus.clear()
            self.parameters.clear()
            self.last_scan = None
            self.identity = await self._identify_vehicle([])
            status = await self._status_unlocked()
            return ConnectResult(
                interface=status, identity=self.identity, profile=self._profile(self.identity.vin)
            )

    async def disconnect(self) -> None:
        async with self._exclusive("disconnect", wait=5.0), operation_scope("disconnect"):
            await self.interface.disconnect()
            self._connected = False
            self.identity = None
            self.ecus.clear()
            self.parameters.clear()
            self._obd_voltage = None

    async def status(self) -> InterfaceStatus:
        if self._lock.locked():
            return await self.interface.status()
        async with self._exclusive("status"):
            return await self._status_unlocked()

    async def _status_unlocked(self) -> InterfaceStatus:
        status = await self.interface.status()
        if status.connected and status.vehicle_voltage is None and self._obd_voltage is not None:
            address, _ = self._obd_voltage
            try:
                response = await self._client(address).request(
                    obd.build_request(obd.ObdMode.CURRENT_DATA, 0x42)
                )
                data = obd.parse_mode01_response(response, [0x42])
                voltage = round(obd.PIDS[0x42].decode(data[0x42]), 2)
                status = status.model_copy(
                    update={"vehicle_voltage": voltage, "voltage_source": "OBD_PID_42"}
                )
            except DiagnosticError:
                pass
        return status

    def _require_connected(self) -> None:
        if not self._connected:
            raise NotConnectedError("Not connected to a vehicle")

    # ------------------------------------------------------------------ identity

    async def _functional(self, payload: bytes) -> list[tuple[DiagnosticAddress, bytes]]:
        try:
            return await self.interface.functional_request(payload, self.config.functional_timeout)
        except UnsupportedOperationError:
            return []

    async def _identify_vehicle(self, ecu_sources: Sequence[VinSource]) -> VehicleIdentity:
        sources: list[VinSource] = []
        for address, response in await self._functional(
            obd.build_request(obd.ObdMode.VEHICLE_INFORMATION, 0x02)
        ):
            try:
                sources.append(
                    VinSource(ecu=address.id, method="OBD_MODE_09_PID_02", vin=obd.parse_vin(response))
                )
            except DiagnosticError:
                continue
        for address, response in await self._functional(bytes([0x22, 0xF1, 0x90])):
            try:
                data = parse_read_data_by_identifier(response, StandardDid.VIN)
                vin = data.decode("ascii").strip("\x00 ")
            except (DiagnosticError, UnicodeDecodeError):
                continue
            if address.id not in {s.ecu for s in ecu_sources}:
                sources.append(VinSource(ecu=address.id, method="UDS_DID_F190", vin=vin))
        if not sources and not ecu_sources and len(self.interface.candidate_addresses()) <= 16:
            # Interfaces without functional addressing (e.g. DoIP): ask the few candidates directly.
            for address in self.interface.candidate_addresses():
                try:
                    data = await self._client(address).read_data_by_identifier(StandardDid.VIN)
                    sources.append(
                        VinSource(ecu=address.id, method="UDS_DID_F190", vin=data.decode("ascii").strip())
                    )
                except (DiagnosticError, UnicodeDecodeError):
                    continue
        sources.extend(ecu_sources)
        return self._identity_from_sources(sources)

    @staticmethod
    def _identity_from_sources(sources: Sequence[VinSource]) -> VehicleIdentity:
        warnings: list[str] = []
        normalized = [s.model_copy(update={"vin": normalize_vin(s.vin)}) for s in sources]
        counts = Counter(s.vin for s in normalized if is_valid_format(s.vin))
        if not counts:
            if normalized:
                warnings.append("ECUs reported a VIN that is not a valid 17-character VIN")
            else:
                warnings.append("No ECU reported a VIN (OBD Mode 09 / UDS 0xF190)")
            return VehicleIdentity(vin=None, sources=normalized, consistent=True, warnings=warnings)
        vin, _ = counts.most_common(1)[0]
        consistent = len(counts) == 1
        if not consistent:
            for s in normalized:
                if s.vin != vin:
                    warnings.append(
                        f"ECU {s.ecu} reports VIN {s.vin}, majority is {vin}: the module may come from "
                        "another vehicle or need its VIN programmed"
                    )
        check = check_digit_valid(vin)
        if not check:
            warnings.append("VIN check digit mismatch (mandatory only for North American vehicles)")
        return VehicleIdentity(
            vin=vin,
            vin_valid_format=True,
            vin_check_digit_valid=check,
            sources=normalized,
            consistent=consistent,
            warnings=warnings,
        )

    async def identify_vehicle(self) -> VehicleIdentity:
        self._require_connected()
        async with self._exclusive("identify_vehicle", wait=5.0), operation_scope("identify_vehicle"):
            ecu_sources = [
                VinSource(ecu=e.info.id, method="UDS_DID_F190", vin=e.info.vin)
                for e in self.ecus.values()
                if e.info.vin
            ]
            self.identity = await self._identify_vehicle(ecu_sources)
            return self.identity

    # ------------------------------------------------------------------ scan

    async def full_scan(self) -> ScanResult:
        self._require_connected()
        started_at = datetime.now(UTC)
        started = time.monotonic()
        async with self._exclusive("full_scan"), operation_scope("full_scan"):
            with TraceCollector() as trace:
                warnings: list[str] = []
                status = await self.interface.status()
                if not status.connected:
                    raise NotConnectedError("Interface lost the vehicle connection")

                obd_names: dict[int, str] = {}
                for address, response in await self._functional(
                    obd.build_request(obd.ObdMode.VEHICLE_INFORMATION, 0x0A)
                ):
                    try:
                        obd_names[address.response] = obd.parse_ecu_name(response)
                    except DiagnosticError:
                        continue

                discovery = await discover_ecus(
                    self.interface, self.config.discovery, self._read_client_factory
                )
                warnings.extend(discovery.warnings)
                if not discovery.found:
                    warnings.append("No ECU answered. Check ignition, the adapter and the address plan.")

                semaphore = asyncio.Semaphore(self.config.scan_concurrency)

                async def scan_one(
                    address: DiagnosticAddress,
                ) -> tuple[DiagnosticAddress, list[IdentificationValue], EcuDtcReadout]:
                    async with semaphore:
                        client = self._client(address)
                        identification = await read_identification(client)
                        name = identification_text(identification, StandardDid.SYSTEM_NAME_OR_ENGINE_TYPE)
                        readout = await read_ecu_dtcs(
                            client,
                            ecu_id=address.id,
                            ecu_name=name or obd_names.get(address.response) or f"ECU {address.id}",
                            ecu_request=address.request,
                            catalog=self.catalog,
                            details_limit=self.config.dtc_details_limit,
                        )
                        return address, identification, readout

                results = await asyncio.gather(
                    *(scan_one(a) for a in discovery.found), return_exceptions=True
                )
                scanned: list[tuple[DiagnosticAddress, list[IdentificationValue], EcuDtcReadout]] = []
                for address, result in zip(discovery.found, results, strict=True):
                    if isinstance(result, DiagnosticConnectionError):
                        self.link_failures += 1
                        raise result
                    if isinstance(result, BaseException):
                        if not isinstance(result, DiagnosticError):
                            raise result
                        warnings.append(f"{address.id}: scan failed ({result.message})")
                        continue
                    scanned.append(result)

                # Live-data discovery (OBD bitmaps + verified DIDs) completes the capability picture.
                ecu_pairs = [(a.id, a) for a, _, _ in scanned]
                bound, live_warnings = await discover_parameters(
                    self.interface, ecu_pairs, self.catalog, self._read_client_factory
                )
                warnings.extend(live_warnings)
                self.parameters = {p.definition.id: p for p in bound}
                live_by_ecu = Counter(p.definition.ecu_id for p in bound)
                obd_ecus = {p.definition.ecu_id for p in bound if p.definition.access == "OBD_MODE_01"}
                obd_voltage = next(
                    (
                        p
                        for p in bound
                        if p.definition.access == "OBD_MODE_01" and p.definition.identifier == 0x42
                    ),
                    None,
                )
                self._obd_voltage = (obd_voltage.address, obd_voltage.definition.id) if obd_voltage else None

                ecus: list[EcuInfo] = []
                dtcs: list[Dtc] = []
                for address, identification, readout in scanned:
                    info = self._build_ecu_info(
                        address,
                        identification=identification,
                        readout=readout,
                        obd_names=obd_names,
                        live_parameter_count=live_by_ecu[address.id],
                        obd_capable=address.id in obd_ecus,
                    )
                    ecus.append(info)
                    dtcs.extend(readout.dtcs)
                    warnings.extend(readout.warnings)

                ecu_sources = [VinSource(ecu=e.id, method="UDS_DID_F190", vin=e.vin) for e in ecus if e.vin]
                previous_obd = [
                    s for s in (self.identity.sources if self.identity else []) if s.method != "UDS_DID_F190"
                ]
                identity = self._identity_from_sources([*previous_obd, *ecu_sources])
                if self.identity and self.identity.vin and identity.vin and identity.vin != self.identity.vin:
                    warnings.append(
                        f"VIN changed since connect ({self.identity.vin} -> {identity.vin}): "
                        "a different vehicle may be connected"
                    )
                self.identity = identity
                warnings.extend(identity.warnings)
                self.ecus = {e.id: _KnownEcu(a, e) for (a, _, _), e in zip(scanned, ecus, strict=True)}
                self.link_failures = 0
                status = await self._status_unlocked()

                scan = ScanResult(
                    vehicle=ScanVehicle(
                        vin=identity.vin, identity=identity, profile=self._profile(identity.vin)
                    ),
                    ecus=ecus,
                    dtcs=dtcs,
                    warnings=list(dict.fromkeys(warnings)),
                    interface=status,
                    started_at=started_at,
                    duration_ms=round((time.monotonic() - started) * 1000),
                    probed_addresses=discovery.probed,
                    trace=trace.entries[-1000:],
                )
                self.last_scan = scan
                return scan

    @staticmethod
    def _build_ecu_info(
        address: DiagnosticAddress,
        *,
        identification: list[IdentificationValue],
        readout: EcuDtcReadout,
        obd_names: dict[int, str],
        live_parameter_count: int,
        obd_capable: bool,
    ) -> EcuInfo:
        system_name = identification_text(identification, StandardDid.SYSTEM_NAME_OR_ENGINE_TYPE)
        if system_name:
            name, name_source = system_name, EvidenceSource.ECU_RESPONSE
        elif address.response in obd_names:
            name, name_source = obd_names[address.response], EvidenceSource.ECU_RESPONSE
        else:
            name, name_source = f"ECU {address.id}", EvidenceSource.NONE
        vin = identification_text(identification, StandardDid.VIN)
        auth_dids = [v for v in identification if v.status == "OEM_AUTH_REQUIRED"]
        capabilities = ECUCapabilities(
            read_dtc=readout.read_dtc,
            clear_dtc=NOT_PROBED_MUTATION,
            dtc_severity=readout.severity,
            freeze_frames=readout.freeze_frames,
            live_data=supported(f"{live_parameter_count} live parameter(s) answered a test read")
            if live_parameter_count
            else Capability.unknown("No standard or verified live-data definition answered for this ECU"),
            obd=supported("Answered OBD-II Mode 01 supported-PID request")
            if obd_capable
            else Capability.unknown("No OBD-II Mode 01 response"),
            extended_session=NOT_PROBED_MILESTONE,
            security_access=Capability(
                status=CapabilityStatus.OEM_AUTH_REQUIRED,
                source=EvidenceSource.ECU_RESPONSE,
                evidence=f"{len(auth_dids)} identification DID(s) answered securityAccessDenied",
            )
            if auth_dids
            else NOT_PROBED_MILESTONE,
            coding=NOT_PROBED_MUTATION,
            adaptation=NOT_PROBED_MUTATION,
            flashing=NOT_PROBED_MUTATION,
        )
        return EcuInfo(
            id=address.id,
            name=name,
            name_source=name_source,
            request_address=address.request,
            response_address=address.response,
            protocol=address.protocol_label,
            hardware_version=identification_text(
                identification,
                StandardDid.SYSTEM_SUPPLIER_ECU_HARDWARE_VERSION_NUMBER,
                StandardDid.VEHICLE_MANUFACTURER_ECU_HARDWARE_NUMBER,
            ),
            software_version=identification_text(
                identification,
                StandardDid.SYSTEM_SUPPLIER_ECU_SOFTWARE_VERSION_NUMBER,
                StandardDid.VEHICLE_MANUFACTURER_ECU_SOFTWARE_NUMBER,
            ),
            part_number=identification_text(
                identification, StandardDid.VEHICLE_MANUFACTURER_SPARE_PART_NUMBER
            ),
            serial_number=identification_text(identification, StandardDid.ECU_SERIAL_NUMBER),
            vin=normalize_vin(vin) if vin else None,
            responded_to=[
                "TesterPresent",
                *(["ReadDTCInformation"] if readout.read_dtc.status is CapabilityStatus.SUPPORTED else []),
            ],
            identification=identification,
            capabilities=capabilities,
            warnings=readout.warnings,
        )

    # ------------------------------------------------------------------ live data

    async def live_parameters(self) -> list[LiveParameterDefinition]:
        self._require_connected()
        if not self.parameters and self.ecus:
            async with (
                self._exclusive("live_data_discovery", wait=5.0),
                operation_scope("live_data_discovery"),
            ):
                bound, _ = await discover_parameters(
                    self.interface,
                    [(e.info.id, e.address) for e in self.ecus.values()],
                    self.catalog,
                    self._read_client_factory,
                )
                self.parameters = {p.definition.id: p for p in bound}
        return [p.definition for p in self.parameters.values()]

    async def read_live(self, parameter_ids: Sequence[str]) -> LiveDataSnapshot:
        self._require_connected()
        unknown = [i for i in parameter_ids if i not in self.parameters]
        if unknown:
            raise ECUNotFoundError(
                "Unknown live parameter(s); run a scan to discover parameters",
                details={"unknown": unknown[:20]},
            )
        started = time.monotonic()
        async with self._exclusive("live_data_read", wait=2.0):
            values = await read_parameters(
                [self.parameters[i] for i in parameter_ids], self.catalog, self._read_client_factory
            )
        return LiveDataSnapshot(
            vin=self.identity.vin if self.identity else None,
            values=values,
            duration_ms=round((time.monotonic() - started) * 1000),
        )

    # ------------------------------------------------------------------ safety & mutations

    async def check_safety(self, operation: str, risk: OperationRisk) -> SafetyDecision:
        status = await self.status()
        return self.safety.evaluate(operation, risk, status, link_failures=self.link_failures)

    async def _read_dtcs_for(self, known: _KnownEcu) -> list[Dtc]:
        readout = await read_ecu_dtcs(
            self._client(known.address),
            ecu_id=known.info.id,
            ecu_name=known.info.name,
            ecu_request=known.address.request,
            catalog=self.catalog,
            details_limit=0,
        )
        return readout.dtcs

    async def clear_dtcs(
        self,
        ecu_id: str,
        *,
        expected_vin: str,
        permissions: frozenset[Permission],
        confirm: bool,
    ) -> ClearDtcResult:
        """READ -> VALIDATE (permission, VIN, safety) -> WRITE (0x14) -> VERIFY (re-read)."""

        self._require_connected()
        if not confirm:
            raise ConfirmationRequiredError(
                "Clearing DTCs erases stored fault data; explicit confirmation required"
            )
        if Permission.DTC_CLEAR not in permissions:
            raise PermissionDeniedError("Clearing DTCs requires the dtc:clear permission")
        known = self.ecus.get(ecu_id)
        if known is None:
            raise ECUNotFoundError(
                f"ECU {ecu_id} is not known; run a full scan first", details={"ecu_id": ecu_id}
            )
        started = time.monotonic()
        async with self._exclusive("clear_dtc", wait=5.0), operation_scope("clear_dtc", ecu=ecu_id):
            identity = await self._identify_vehicle(
                [VinSource(ecu=known.info.id, method="UDS_DID_F190", vin=known.info.vin)]
                if known.info.vin
                else []
            )
            if identity.vin is None or normalize_vin(expected_vin) != identity.vin:
                raise VinMismatchError(
                    "Connected vehicle does not match the requested VIN",
                    details={"expected_vin": expected_vin, "connected_vin": identity.vin},
                )
            status = await self._status_unlocked()
            decision = self.safety.evaluate(
                "clear_dtc", OperationRisk.LOW_RISK_WRITE, status, link_failures=self.link_failures
            )
            if not decision.allowed:
                error_cls = (
                    LowVoltageError
                    if decision.verdict is SafetyVerdict.BLOCKED_LOW_VOLTAGE
                    else SafetyBlockedError
                )
                raise error_cls(
                    "Safety check blocked clearing DTCs: " + "; ".join(decision.reasons),
                    details={"safety": decision.model_dump(mode="json")},
                )
            before = await self._read_dtcs_for(known)
            await self._client(known.address, permissions=permissions).clear_diagnostic_information(0xFFFFFF)
            after = await self._read_dtcs_for(known)
            return ClearDtcResult(
                ecu_id=ecu_id,
                cleared=True,
                dtcs_before=before,
                dtcs_after=after,
                safety=decision,
                duration_ms=round((time.monotonic() - started) * 1000),
            )
