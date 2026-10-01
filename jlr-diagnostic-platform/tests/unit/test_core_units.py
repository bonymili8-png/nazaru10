from __future__ import annotations

import json
from datetime import UTC, date, datetime
from pathlib import Path

import pytest

from jlr_diagnostic_core.access import GuardedTransport, SecurityAccessManager, required_permission
from jlr_diagnostic_core.capabilities import capability_from_error
from jlr_diagnostic_core.catalog import (
    SAE_GENERIC_CATALOG,
    CatalogSet,
    DefinitionCatalog,
    is_manufacturer_specific,
)
from jlr_diagnostic_core.dtc import build_dtc, compare_dtcs, export_dtcs_csv, filter_dtcs, group_dtcs
from jlr_diagnostic_core.safety import VehicleSafetyChecker
from jlr_protocols.uds import UdsClient
from jlr_shared_types.errors import (
    DiagnosticTimeoutError,
    NegativeResponseError,
    PermissionDeniedError,
    SecurityAccessRequiredError,
)
from jlr_shared_types.models import (
    CapabilityStatus,
    DtcSeverity,
    EvidenceSource,
    IgnitionState,
    InterfaceKind,
    InterfaceStatus,
    OperationRisk,
    SafetyVerdict,
)
from jlr_shared_types.permissions import Permission, Role, permissions_for
from jlr_vehicle_model import build_profile, check_digit_valid, decode_vin, with_check_digit

# ------------------------------------------------------------------ VIN / profile


def test_vin_check_digit() -> None:
    assert check_digit_valid("1M8GDM9AXKP042788")  # textbook example from ISO 3779 / 49 CFR 565
    assert not check_digit_valid("1M8GDM9A1KP042788")
    vin = with_check_digit("SALKA9AE0RA900101")
    assert check_digit_valid(vin)


def test_decode_vin() -> None:
    decoded = decode_vin("SALKA9AE6RA900101", today=date(2026, 10, 1))
    assert decoded.valid_format
    assert decoded.manufacturer == "Land Rover"
    assert decoded.model_year == 2024
    assert decoded.model_year_candidates == [1994, 2024]
    assert decoded.warnings == []


def test_decode_invalid_vin() -> None:
    assert not decode_vin("SALKA9AE6RA90010I").valid_format
    unknown = decode_vin(with_check_digit("WVWZZZ1KZ0W000001"))
    assert unknown.manufacturer is None
    assert any("WMI" in w for w in unknown.warnings)


def test_profile_never_invents_model() -> None:
    profile = build_profile("SALKA9AE6RA900101")
    assert profile.make.value == "Land Rover"
    assert profile.make.source is EvidenceSource.ISO_STANDARD
    assert profile.model.value is None
    assert profile.engine.source is EvidenceSource.NONE
    simulated = build_profile(
        "SALKA9AE6RA900101", overrides={"model": {"value": "Range Rover", "source": "SIMULATION"}}
    )
    assert simulated.model.source is EvidenceSource.SIMULATION
    assert simulated.schema_version == "vehicle-profile/1"


# ------------------------------------------------------------------ capability classification


@pytest.mark.parametrize(
    ("nrc", "status"),
    [
        (0x11, CapabilityStatus.NOT_SUPPORTED),
        (0x12, CapabilityStatus.NOT_SUPPORTED),
        (0x31, CapabilityStatus.NOT_SUPPORTED),
        (0x7F, CapabilityStatus.SUPPORTED_WITH_PREREQUISITES),
        (0x22, CapabilityStatus.SUPPORTED_WITH_PREREQUISITES),
        (0x33, CapabilityStatus.OEM_AUTH_REQUIRED),
        (0x34, CapabilityStatus.OEM_AUTH_REQUIRED),
        (0x10, CapabilityStatus.UNKNOWN),
    ],
)
def test_capability_from_nrc(nrc: int, status: CapabilityStatus) -> None:
    capability = capability_from_error(NegativeResponseError(0x19, nrc, "x"), "probe")
    assert capability.status is status
    assert capability.source is EvidenceSource.ECU_RESPONSE


def test_capability_from_timeout_is_unknown() -> None:
    capability = capability_from_error(DiagnosticTimeoutError("t"), "probe")
    assert capability.status is CapabilityStatus.UNKNOWN
    assert "timeout" in capability.evidence


# ------------------------------------------------------------------ safety


def status(
    voltage: float | None = 12.6, *, connected: bool = True, ignition: IgnitionState = IgnitionState.ON
) -> InterfaceStatus:
    return InterfaceStatus(
        kind=InterfaceKind.MOCK, connected=connected, vehicle_voltage=voltage, ignition=ignition
    )


@pytest.mark.parametrize(
    ("risk", "voltage", "verdict"),
    [
        (OperationRisk.READ_ONLY, 10.0, SafetyVerdict.ALLOWED_WITH_WARNINGS),
        (OperationRisk.LOW_RISK_WRITE, 12.6, SafetyVerdict.ALLOWED),
        (OperationRisk.LOW_RISK_WRITE, 11.0, SafetyVerdict.BLOCKED_LOW_VOLTAGE),
        (OperationRisk.LOW_RISK_WRITE, None, SafetyVerdict.ALLOWED_WITH_WARNINGS),
        (OperationRisk.CONFIGURATION_WRITE, None, SafetyVerdict.BLOCKED_VOLTAGE_UNKNOWN),
        (OperationRisk.CONFIGURATION_WRITE, 12.1, SafetyVerdict.BLOCKED_LOW_VOLTAGE),
        (OperationRisk.FLASHING, 12.6, SafetyVerdict.BLOCKED_LOW_VOLTAGE),
        (OperationRisk.FLASHING, 13.5, SafetyVerdict.ALLOWED),
        (OperationRisk.FLASHING, 16.0, SafetyVerdict.BLOCKED_HIGH_VOLTAGE),
    ],
)
def test_safety_voltage(risk: OperationRisk, voltage: float | None, verdict: SafetyVerdict) -> None:
    decision = VehicleSafetyChecker().evaluate("op", risk, status(voltage))
    assert decision.verdict is verdict
    assert decision.allowed == (verdict in (SafetyVerdict.ALLOWED, SafetyVerdict.ALLOWED_WITH_WARNINGS))


def test_safety_other_blocks() -> None:
    checker = VehicleSafetyChecker()
    assert (
        checker.evaluate("op", OperationRisk.READ_ONLY, status(connected=False)).verdict
        is SafetyVerdict.BLOCKED_NOT_CONNECTED
    )
    assert (
        checker.evaluate("op", OperationRisk.LOW_RISK_WRITE, status(ignition=IgnitionState.OFF)).verdict
        is SafetyVerdict.BLOCKED_IGNITION_OFF
    )
    assert (
        checker.evaluate("op", OperationRisk.LOW_RISK_WRITE, status(), link_failures=3).verdict
        is SafetyVerdict.BLOCKED_UNSTABLE_CONNECTION
    )
    assert (
        checker.evaluate("op", OperationRisk.FLASHING, status(13.5), requires_oem_auth=True).verdict
        is SafetyVerdict.REQUIRES_OEM_AUTH
    )
    assert (
        checker.evaluate("op", OperationRisk.FLASHING, status(13.5, ignition=IgnitionState.UNKNOWN)).verdict
        is SafetyVerdict.BLOCKED_IGNITION_OFF
    )


# ------------------------------------------------------------------ catalog


@pytest.mark.parametrize(
    ("code", "manufacturer"),
    [
        ("P0300", False),
        ("P1234", True),
        ("P2463", False),
        ("P3000", True),
        ("P3400", False),
        ("B1A55", True),
        ("U0121", False),
        ("C2000", True),
    ],
)
def test_manufacturer_specific_ranges(code: str, manufacturer: bool) -> None:
    assert is_manufacturer_specific(code) is manufacturer


def test_catalog_never_describes_manufacturer_codes_from_generic_table() -> None:
    generic = DefinitionCatalog(
        name="bad", version="1", source=EvidenceSource.ISO_STANDARD, dtc_descriptions={"P1234": "guess"}
    )
    catalogs = CatalogSet([generic, SAE_GENERIC_CATALOG])
    assert catalogs.describe_dtc("P1234") == (None, EvidenceSource.NONE)
    assert catalogs.describe_dtc("P0300")[1] is EvidenceSource.ISO_STANDARD


def test_user_catalog_from_json(tmp_path: Path) -> None:
    path = tmp_path / "catalog.json"
    path.write_text(
        json.dumps(
            {
                "name": "Workshop verified",
                "version": "2026-09",
                "dtc_descriptions": {"p1234": "Verified description"},
                "did_parameters": {
                    "0x7E0": [{"did": "0x1234", "name": "Test", "unit": "V", "length": 2, "scale": 0.01}]
                },
                "occurrence_records": {"0x7E0": {"record_number": 2}},
            }
        )
    )
    catalog = DefinitionCatalog.from_json(path)
    catalogs = CatalogSet([catalog, SAE_GENERIC_CATALOG])
    assert catalogs.describe_dtc("P1234") == ("Verified description", EvidenceSource.USER_VERIFIED)
    parameter, source = catalogs.did_parameters(0x7E0)[0]
    assert source is EvidenceSource.USER_VERIFIED
    assert parameter.decode(b"\x04\xd2") == pytest.approx(12.34)
    assert catalogs.occurrence_record(0x7E0).record_number == 2  # type: ignore[union-attr]
    assert catalogs.did_parameters(0x7E1) == []


# ------------------------------------------------------------------ DTC engine


def make(ecu: str, code_raw: int, status_byte: int) -> object:
    return build_dtc(
        ecu_id=ecu,
        ecu_name=f"ECU {ecu}",
        raw=code_raw,
        status_byte=status_byte,
        catalog=CatalogSet(),
        read_at=datetime(2026, 10, 1, tzinfo=UTC),
    )


def test_build_dtc_enrichment() -> None:
    dtc = make("0x7E0", 0x030000, 0xAF)
    assert dtc.display == "P0300-00"  # type: ignore[attr-defined]
    assert dtc.description == "Random/Multiple Cylinder Misfire Detected"  # type: ignore[attr-defined]
    assert dtc.severity is DtcSeverity.WARNING_INDICATOR  # type: ignore[attr-defined]
    unknown = make("0x726", 0x9A5511, 0x2F)
    assert unknown.description is None  # type: ignore[attr-defined]
    assert unknown.description_source is EvidenceSource.NONE  # type: ignore[attr-defined]


def test_filter_group_compare_export() -> None:
    a = make("0x7E0", 0x030000, 0xAF)  # active, confirmed
    b = make("0x7E0", 0x042000, 0x28)  # history
    c = make("0x760", 0xC12100, 0x24)  # pending
    dtcs = [a, b, c]
    assert filter_dtcs(dtcs, state="active") == [a]  # type: ignore[arg-type]
    assert filter_dtcs(dtcs, state="history") == [b]  # type: ignore[arg-type]
    assert filter_dtcs(dtcs, state="pending") == [a, c]  # type: ignore[arg-type]
    assert filter_dtcs(dtcs, ecu_id="0x760") == [c]  # type: ignore[arg-type]
    assert filter_dtcs(dtcs, system="U") == [c]  # type: ignore[arg-type]
    assert filter_dtcs(dtcs, search="catalyst") == [b]  # type: ignore[arg-type]
    groups = group_dtcs(dtcs, "system")  # type: ignore[arg-type]
    assert set(groups) == {"Powertrain", "Network"}
    comparison = compare_dtcs([a, b], [b, c])  # type: ignore[list-item]
    assert comparison.appeared == [c]
    assert comparison.resolved == [a]
    assert comparison.persisting == [b]
    csv_text = export_dtcs_csv(dtcs)  # type: ignore[arg-type]
    assert csv_text.splitlines()[0].startswith("ecu_id,ecu_name,display")
    assert "P0300-00" in csv_text


def test_csv_export_neutralises_formulas() -> None:
    dtc = make("0x7E0", 0x030000, 0xAF)
    hostile = dtc.model_copy(update={"description": '=HYPERLINK("http://x")'})  # type: ignore[attr-defined]
    assert "'=HYPERLINK" in export_dtcs_csv([hostile])


# ------------------------------------------------------------------ access guard


class Recorder:
    label = "0x7E0"

    def __init__(self) -> None:
        self.sent: list[bytes] = []

    async def send(self, payload: bytes) -> None:
        self.sent.append(payload)

    async def recv(self, timeout: float) -> bytes:
        raise DiagnosticTimeoutError("no")


@pytest.mark.parametrize(
    ("payload", "permission"),
    [
        (b"\x2e\x12\x34\x00", Permission.UDS_WRITE_DATA),
        (b"\x31\x01\xff\x00", Permission.UDS_ROUTINE_CONTROL),
        (b"\x27\x01", Permission.UDS_SECURITY_ACCESS),
        (b"\x34\x00\x44", Permission.UDS_TRANSFER),
        (b"\x10\x02", Permission.UDS_TRANSFER),
        (b"\x11\x01", Permission.UDS_ECU_RESET),
        (b"\x14\xff\xff\xff", Permission.DTC_CLEAR),
        (b"\x23\x24", Permission.UDS_MEMORY_READ),
        (b"\x28\x03\x01", Permission.UDS_COMMUNICATION_CONTROL),
    ],
)
async def test_guard_blocks_sensitive_services(payload: bytes, permission: Permission) -> None:
    assert required_permission(payload) is permission
    inner = Recorder()
    guard = GuardedTransport(inner, permissions_for(Role.ADMIN))
    if permission not in permissions_for(Role.ADMIN):
        with pytest.raises(PermissionDeniedError):
            await guard.send(payload)
        assert inner.sent == []


async def test_guard_allows_reads() -> None:
    inner = Recorder()
    guard = GuardedTransport(inner, frozenset())
    for payload in (b"\x22\xf1\x90", b"\x19\x02\xff", b"\x3e\x00", b"\x10\x03", b"\x01\x0c"):
        await guard.send(payload)
    assert len(inner.sent) == 5


def test_no_role_grants_security_sensitive_services_in_milestone_1() -> None:
    sensitive = {
        Permission.UDS_WRITE_DATA,
        Permission.UDS_ROUTINE_CONTROL,
        Permission.UDS_SECURITY_ACCESS,
        Permission.UDS_TRANSFER,
        Permission.UDS_ECU_RESET,
        Permission.UDS_MEMORY_READ,
        Permission.UDS_COMMUNICATION_CONTROL,
    }
    for role in Role:
        assert not (permissions_for(role) & sensitive)


async def test_security_access_without_provider_is_oem_auth_required() -> None:
    client = UdsClient(Recorder())
    with pytest.raises(SecurityAccessRequiredError, match="OEM_AUTH_REQUIRED"):
        await SecurityAccessManager().unlock(client, 0x01)


async def test_security_access_never_retries() -> None:
    class Provider:
        async def compute_key(self, ecu_id: str, level: int, seed: bytes) -> bytes:
            return b"\x00\x00"

    class Ecu(Recorder):
        async def recv(self, timeout: float) -> bytes:
            return b"\x67\x01\x12\x34" if self.sent[-1][1] == 0x01 else b"\x7f\x27\x35"

    ecu = Ecu()
    manager = SecurityAccessManager(Provider())
    with pytest.raises(SecurityAccessRequiredError, match="not retrying"):
        await manager.unlock(UdsClient(ecu), 0x01)
    with pytest.raises(SecurityAccessRequiredError, match="already attempted"):
        await manager.unlock(UdsClient(ecu), 0x01)
    assert len(ecu.sent) == 2  # one seed request, one key — never more
