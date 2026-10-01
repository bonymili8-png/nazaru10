"""Failure handling: timeout, disconnect, invalid response, low voltage, wrong VIN, wrong ECU,
incompatible request, interrupted operation."""

from __future__ import annotations

import pytest

from jlr_diagnostic_core import DiagnosticService
from jlr_diagnostic_core.transports import J2534Interface
from jlr_shared_types.errors import (
    ConfirmationRequiredError,
    DiagnosticConnectionError,
    ECUNotFoundError,
    LowVoltageError,
    NotConnectedError,
    OperationInProgressError,
    PermissionDeniedError,
    SafetyBlockedError,
    UnsupportedOperationError,
    VinMismatchError,
)
from jlr_shared_types.models import OperationRisk, SafetyVerdict
from jlr_shared_types.permissions import Permission, Role, permissions_for
from jlr_simulator import JLRVehicleSimulator

TECH = permissions_for(Role.TECHNICIAN)


async def test_silent_ecu_is_absent_not_invented(
    connected: DiagnosticService, simulator: JLRVehicleSimulator
) -> None:
    simulator.faults.silent_ecus.add(0x760)
    scan = await connected.full_scan()
    assert "0x760" not in {e.id for e in scan.ecus}
    assert len(scan.ecus) == len(simulator.profile.ecus) - 1


async def test_slow_ecu_with_response_pending_still_scanned(
    connected: DiagnosticService, simulator: JLRVehicleSimulator
) -> None:
    simulator.faults.response_pending[0x726] = 2
    scan = await connected.full_scan()
    bcm = next(e for e in scan.ecus if e.id == "0x726")
    assert bcm.software_version == "S25.01.1"


async def test_corrupt_responses_degrade_to_warnings(
    connected: DiagnosticService, simulator: JLRVehicleSimulator
) -> None:
    simulator.faults.corrupt_ecus.add(0x7A6)
    scan = await connected.full_scan()
    suspension = next(e for e in scan.ecus if e.id == "0x7A6")
    assert suspension.capabilities.read_dtc.status.value == "UNKNOWN"
    assert all(v.status == "ERROR" for v in suspension.identification)
    assert any(w.startswith("0x7A6: DTCs could not be read") for w in scan.warnings)
    assert not [d for d in scan.dtcs if d.ecu_id == "0x7A6"]


async def test_interrupted_multiframe_transfer(
    connected: DiagnosticService, simulator: JLRVehicleSimulator
) -> None:
    simulator.isotp  # noqa: B018 - documents that the simulator uses short N_Cr in tests
    simulator.faults.interrupt_multiframe.add(0x720)
    scan = await connected.full_scan()
    cluster = next(e for e in scan.ecus if e.id == "0x720")
    vin = next(v for v in cluster.identification if v.did == 0xF190)
    assert vin.status == "TIMEOUT"  # 17-byte VIN needs consecutive frames that never arrive
    assert cluster.capabilities.read_dtc.status.value == "SUPPORTED"  # short responses still work


async def test_adapter_disconnect_fails_fast_and_recovers(
    connected: DiagnosticService, simulator: JLRVehicleSimulator
) -> None:
    simulator.disconnect_adapter()
    with pytest.raises(DiagnosticConnectionError):
        await connected.full_scan()
    status = await connected.status()
    assert not status.connected
    simulator.reconnect_adapter()
    result = await connected.connect()
    assert result.identity.vin == simulator.vin
    scan = await connected.full_scan()
    assert len(scan.ecus) == len(simulator.profile.ecus)


async def test_operations_require_connection(service: DiagnosticService) -> None:
    with pytest.raises(NotConnectedError):
        await service.full_scan()
    with pytest.raises(NotConnectedError):
        await service.read_live(["0x7E0:obd:0C"])


async def test_module_with_foreign_vin_is_flagged(
    connected: DiagnosticService, simulator: JLRVehicleSimulator
) -> None:
    foreign = "SALWA2AE0SA900202"
    simulator.faults.vin_override[0x760] = foreign
    scan = await connected.full_scan()
    assert scan.vehicle.vin == simulator.vin  # majority wins
    assert not scan.vehicle.identity.consistent
    assert any("0x760" in w and foreign in w for w in scan.warnings)


async def test_clear_dtc_full_flow(connected: DiagnosticService, simulator: JLRVehicleSimulator) -> None:
    await connected.full_scan()
    result = await connected.clear_dtcs("0x7E0", expected_vin=simulator.vin, permissions=TECH, confirm=True)
    assert result.cleared
    assert {d.display for d in result.dtcs_before} == {"P0171-00", "P0420-00"}
    # P0171 is a persistent simulated fault: it is detected again; P0420 (history) is gone.
    assert [d.display for d in result.dtcs_after] == ["P0171-00"]
    assert not result.dtcs_after[0].status.confirmed
    assert result.safety.allowed


async def test_clear_dtc_requires_confirmation_and_permission(
    connected: DiagnosticService, simulator: JLRVehicleSimulator
) -> None:
    await connected.full_scan()
    with pytest.raises(ConfirmationRequiredError):
        await connected.clear_dtcs("0x7E0", expected_vin=simulator.vin, permissions=TECH, confirm=False)
    with pytest.raises(PermissionDeniedError):
        await connected.clear_dtcs(
            "0x7E0", expected_vin=simulator.vin, permissions=permissions_for(Role.VIEWER), confirm=True
        )
    assert len(simulator.ecu("pcm").dtcs) == 2  # nothing was cleared


async def test_clear_dtc_wrong_vin_and_wrong_ecu(
    connected: DiagnosticService, simulator: JLRVehicleSimulator
) -> None:
    await connected.full_scan()
    with pytest.raises(VinMismatchError):
        await connected.clear_dtcs("0x7E0", expected_vin="SALWA2AE0SA900202", permissions=TECH, confirm=True)
    with pytest.raises(ECUNotFoundError):
        await connected.clear_dtcs("0x7FF", expected_vin=simulator.vin, permissions=TECH, confirm=True)
    assert len(simulator.ecu("pcm").dtcs) == 2


async def test_clear_dtc_blocked_by_low_voltage(
    connected: DiagnosticService, simulator: JLRVehicleSimulator
) -> None:
    await connected.full_scan()
    simulator.faults.battery_voltage = 10.9
    decision = await connected.check_safety("clear_dtc", OperationRisk.LOW_RISK_WRITE)
    assert decision.verdict is SafetyVerdict.BLOCKED_LOW_VOLTAGE
    with pytest.raises(LowVoltageError) as info:
        await connected.clear_dtcs("0x7E0", expected_vin=simulator.vin, permissions=TECH, confirm=True)
    assert info.value.details["safety"]["verdict"] == "BLOCKED_LOW_VOLTAGE"
    assert len(simulator.ecu("pcm").dtcs) == 2


async def test_clear_dtc_blocked_with_ignition_off(
    connected: DiagnosticService, simulator: JLRVehicleSimulator
) -> None:
    await connected.full_scan()
    simulator.faults.ignition_off = True
    with pytest.raises(SafetyBlockedError):
        await connected.clear_dtcs("0x7E0", expected_vin=simulator.vin, permissions=TECH, confirm=True)


async def test_vehicle_swap_after_scan_is_detected(service: DiagnosticService) -> None:
    sim_a = JLRVehicleSimulator("range_rover")
    from tests.conftest import make_service

    svc = make_service(sim_a)
    await svc.connect()
    await svc.full_scan()
    # A different car now answers on the same bus (e.g. adapter moved): every ECU reports another VIN.
    for spec in sim_a.profile.ecus:
        sim_a.faults.vin_override[spec.request_id] = "SALWA2AE0SA900202"
    with pytest.raises(VinMismatchError):
        await svc.clear_dtcs("0x7E0", expected_vin=sim_a.vin, permissions=TECH, confirm=True)
    await svc.disconnect()


async def test_unknown_live_parameter_rejected(connected: DiagnosticService) -> None:
    await connected.full_scan()
    with pytest.raises(ECUNotFoundError):
        await connected.read_live(["0x7E0:did:FFFF"])


async def test_concurrent_scan_rejected(connected: DiagnosticService) -> None:
    import asyncio

    first = asyncio.create_task(connected.full_scan())
    await asyncio.sleep(0.01)
    with pytest.raises(OperationInProgressError):
        await connected.full_scan()
    await first


async def test_live_data_timeout_reported_per_parameter(
    connected: DiagnosticService, simulator: JLRVehicleSimulator
) -> None:
    await connected.full_scan()
    ids = [p.id for p in await connected.live_parameters() if p.ecu_id == "0x726"]
    simulator.faults.silent_ecus.add(0x726)
    snapshot = await connected.read_live(ids)
    assert {v.status for v in snapshot.values} == {"TIMEOUT"}


async def test_j2534_is_an_explicit_limitation() -> None:
    interface = J2534Interface()
    with pytest.raises(UnsupportedOperationError, match="not implemented"):
        await interface.connect()
    assert not (await interface.status()).connected


def test_permissions_never_allow_sensitive_uds() -> None:
    assert Permission.UDS_WRITE_DATA not in TECH
