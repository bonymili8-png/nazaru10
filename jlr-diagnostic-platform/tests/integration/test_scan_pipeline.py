"""Gateway → protocol stack → ECU simulator, end to end (no mocks below the DiagnosticService)."""

from __future__ import annotations

import pytest

from jlr_diagnostic_core import SAE_GENERIC_CATALOG, CatalogSet, DiagnosticService, ServiceConfig
from jlr_diagnostic_core.transports import DoIPInterface
from jlr_shared_types.errors import SecurityAccessRequiredError
from jlr_shared_types.models import CapabilityStatus, DtcSeverity, EvidenceSource, InterfaceKind
from jlr_simulator import PROFILES, JLRVehicleSimulator, SimulatedDoIPEntity
from tests.conftest import FAST_DISCOVERY, make_service


async def test_connect_identifies_vehicle(service: DiagnosticService, simulator: JLRVehicleSimulator) -> None:
    result = await service.connect()
    assert result.identity.vin == simulator.vin
    assert result.identity.vin_check_digit_valid
    assert result.identity.consistent
    assert {s.method for s in result.identity.sources} == {"OBD_MODE_09_PID_02", "UDS_DID_F190"}
    assert result.interface.kind is InterfaceKind.MOCK
    assert result.interface.simulation
    assert result.profile["model"]["source"] == "SIMULATION"
    assert result.profile["make"] == {"value": "Land Rover", "source": "ISO_STANDARD", "note": "WMI SAL"}


async def test_full_scan_discovers_every_simulated_ecu(
    connected: DiagnosticService, simulator: JLRVehicleSimulator
) -> None:
    scan = await connected.full_scan()
    assert {e.request_address for e in scan.ecus} == {s.request_id for s in simulator.profile.ecus}
    assert scan.vehicle.vin == simulator.vin
    assert scan.schema_version == "scan-result/1"
    assert scan.warnings == []
    assert scan.duration_ms > 0
    assert scan.trace and scan.trace[0]["direction"] == "TX"

    pcm = next(e for e in scan.ecus if e.id == "0x7E0")
    assert pcm.name == "Powertrain Control Module"
    assert pcm.name_source is EvidenceSource.ECU_RESPONSE
    assert pcm.software_version == "S24.07.2"
    assert pcm.vin == simulator.vin
    assert pcm.capabilities.read_dtc.status is CapabilityStatus.SUPPORTED
    assert pcm.capabilities.obd.status is CapabilityStatus.SUPPORTED
    assert pcm.capabilities.live_data.status is CapabilityStatus.SUPPORTED
    # Mutating capabilities are never probed:
    assert pcm.capabilities.clear_dtc.status is CapabilityStatus.UNKNOWN
    assert pcm.capabilities.coding.status is CapabilityStatus.UNKNOWN
    assert pcm.capabilities.flashing.status is CapabilityStatus.UNKNOWN

    gateway = next(e for e in scan.ecus if e.id == "0x716")
    assert gateway.capabilities.security_access.status is CapabilityStatus.OEM_AUTH_REQUIRED
    serial = next(v for v in gateway.identification if v.did == 0xF18C)
    assert serial.status == "OEM_AUTH_REQUIRED"

    cluster = next(e for e in scan.ecus if e.id == "0x720")
    assert cluster.capabilities.dtc_severity.status is CapabilityStatus.NOT_SUPPORTED

    restraints = next(e for e in scan.ecus if e.id == "0x737")
    assert restraints.capabilities.live_data.status is CapabilityStatus.UNKNOWN


async def test_scan_dtcs_are_enriched_with_evidence(connected: DiagnosticService) -> None:
    scan = await connected.full_scan()
    by_display = {d.display: d for d in scan.dtcs}
    lean = by_display["P0171-00"]
    assert lean.description == "System Too Lean (Bank 1)"
    assert lean.description_source is EvidenceSource.ISO_STANDARD
    assert lean.severity is DtcSeverity.CHECK_AT_NEXT_HALT
    assert lean.severity_source is EvidenceSource.ECU_RESPONSE
    assert lean.occurrence_count == 5
    assert lean.status.warning_indicator_requested
    assert lean.freeze_frames[0].identifiers == [{"did": "0x0105", "data_hex": "7D"}]

    manufacturer = by_display["B1A55-11"]
    assert manufacturer.description_source is EvidenceSource.SIMULATION
    assert manufacturer.failure_type_description == "Circuit short to ground"

    cluster = by_display["U0121-00"]
    assert cluster.severity is DtcSeverity.UNKNOWN  # cluster refuses 0x19 0x08 and has no warning bit


async def test_live_data_read(connected: DiagnosticService) -> None:
    await connected.full_scan()
    parameters = await connected.live_parameters()
    ids = {p.id for p in parameters}
    assert "0x7E0:obd:0C" in ids
    assert "0x726:did:4201" in ids
    rpm = next(p for p in parameters if p.id == "0x7E0:obd:0C")
    assert rpm.source is EvidenceSource.ISO_STANDARD
    assert next(p for p in parameters if p.id == "0x726:did:4201").source is EvidenceSource.SIMULATION
    snapshot = await connected.read_live(sorted(ids))
    assert len(snapshot.values) == len(ids)
    assert all(v.status == "OK" for v in snapshot.values)
    voltage = next(v for v in snapshot.values if v.id == "0x7E0:obd:42")
    assert 13.0 < (voltage.value or 0) < 15.0
    assert voltage.metadata["access"] == "OBD_MODE_01"


@pytest.mark.parametrize("profile", sorted(PROFILES))
async def test_every_simulation_profile_scans_cleanly(profile: str) -> None:
    simulator = JLRVehicleSimulator(profile)
    service = make_service(simulator)
    try:
        await service.connect()
        scan = await service.full_scan()
    finally:
        await service.disconnect()
    assert scan.vehicle.vin == simulator.vin
    assert len(scan.ecus) == len(simulator.profile.ecus)
    expected = sum(len(s.dtcs) for s in simulator.profile.ecus)
    assert len(scan.dtcs) == expected
    assert scan.vehicle.profile["simulation_profile"] == profile


async def test_can_fd_end_to_end() -> None:
    simulator = JLRVehicleSimulator("defender", fd=True)
    service = make_service(simulator)
    try:
        await service.connect()
        scan = await service.full_scan()
    finally:
        await service.disconnect()
    assert scan.ecus[0].protocol == "UDS/ISO-TP/CAN-FD-11bit"
    assert len(scan.ecus) == len(simulator.profile.ecus)


async def test_doip_end_to_end() -> None:
    simulator = JLRVehicleSimulator("range_rover")
    entity = SimulatedDoIPEntity(simulator)
    port = await entity.start()
    targets = [s.doip_address for s in simulator.profile.ecus if s.doip_address]
    service = DiagnosticService(
        DoIPInterface(
            "127.0.0.1", port, target_addresses=[t for t in targets if t is not None], simulation=True
        ),
        catalog=CatalogSet([simulator.catalog(), SAE_GENERIC_CATALOG]),
        config=ServiceConfig(discovery=FAST_DISCOVERY, functional_timeout=0.05),
    )
    try:
        connect = await service.connect()
        assert connect.identity.vin == simulator.vin
        scan = await service.full_scan()
    finally:
        await service.disconnect()
        await entity.stop()
    assert len(scan.ecus) == len(simulator.profile.ecus)
    assert all(e.protocol == "UDS/DoIP" for e in scan.ecus)
    assert any(d.display == "P0171-00" for d in scan.dtcs)


async def test_doip_authenticated_activation_is_reported_not_bypassed() -> None:
    entity = SimulatedDoIPEntity(JLRVehicleSimulator(), require_authentication=True)
    port = await entity.start()
    interface = DoIPInterface("127.0.0.1", port)
    try:
        with pytest.raises(SecurityAccessRequiredError, match="OEM_AUTH_REQUIRED"):
            await interface.connect()
    finally:
        await interface.disconnect()
        await entity.stop()
