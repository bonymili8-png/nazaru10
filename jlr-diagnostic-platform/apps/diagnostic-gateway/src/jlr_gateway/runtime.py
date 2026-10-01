"""Builds the configured DiagnosticInterface and owns the single DiagnosticService of this gateway."""

from __future__ import annotations

from pathlib import Path

from jlr_diagnostic_core import (
    SAE_GENERIC_CATALOG,
    CatalogSet,
    DefinitionCatalog,
    DiagnosticService,
    DiscoveryConfig,
    SafetyThresholds,
    ServiceConfig,
    VehicleSafetyChecker,
)
from jlr_diagnostic_core.interface import DiagnosticInterface
from jlr_diagnostic_core.transports import CanAddressPlan, DoIPInterface, J2534Interface, SocketCANInterface
from jlr_gateway.settings import GatewaySettings
from jlr_shared_types.errors import UnsupportedOperationError
from jlr_simulator import JLRVehicleSimulator


def load_user_catalogs(directory: str) -> list[DefinitionCatalog]:
    if not directory:
        return []
    path = Path(directory)
    if not path.is_dir():
        return []
    return [DefinitionCatalog.from_json(p) for p in sorted(path.glob("*.json"))]


class GatewayRuntime:
    def __init__(self, settings: GatewaySettings) -> None:
        self.settings = settings
        self.simulator: JLRVehicleSimulator | None = None
        self.service = self._build_service()

    @property
    def simulation(self) -> bool:
        return self.simulator is not None

    def _address_plan(self) -> CanAddressPlan:
        s = self.settings
        return CanAddressPlan(
            request_start=s.address_range_start,
            request_end=s.address_range_end,
            response_offset=s.response_offset,
        )

    def _build_interface(self) -> DiagnosticInterface:
        s = self.settings
        if s.interface == "mock":
            self.simulator = JLRVehicleSimulator(s.sim_profile, seed=s.sim_seed, fd=s.sim_can_fd)
            return self.simulator.create_interface(address_plan=self._address_plan())
        self.simulator = None
        if s.interface == "socketcan":
            return SocketCANInterface(
                s.socketcan_channel, fd=s.socketcan_fd, address_plan=self._address_plan()
            )
        if s.interface == "doip":
            return DoIPInterface(
                s.doip_host,
                s.doip_port,
                target_addresses=s.doip_target_list(),
                functional_address=int(s.doip_functional_address, 16) if s.doip_functional_address else None,
            )
        if s.interface == "j2534":
            return J2534Interface(s.j2534_library or None)
        raise UnsupportedOperationError(f"Unknown interface {s.interface!r}")

    def _build_service(self) -> DiagnosticService:
        s = self.settings
        interface = self._build_interface()
        catalogs = load_user_catalogs(s.catalog_dir)
        if self.simulator is not None:
            catalogs.append(self.simulator.catalog())
        catalogs.append(SAE_GENERIC_CATALOG)
        return DiagnosticService(
            interface,
            catalog=CatalogSet(catalogs),
            config=ServiceConfig(
                discovery=DiscoveryConfig(
                    probe_timeout=s.probe_timeout,
                    concurrency=s.discovery_concurrency,
                    passive_listen=s.passive_listen,
                ),
                scan_concurrency=s.scan_concurrency,
            ),
            safety=VehicleSafetyChecker(
                SafetyThresholds(
                    min_voltage_low_risk=s.safety_min_voltage_low_risk,
                    min_voltage_configuration=s.safety_min_voltage_configuration,
                    min_voltage_flashing=s.safety_min_voltage_flashing,
                )
            ),
            profile_overrides=self.simulator.profile_overrides() if self.simulator else None,
        )

    async def switch_simulation_profile(self, profile: str) -> None:
        if self.simulator is None:
            raise UnsupportedOperationError("Simulation profiles are only available with the mock interface")
        await self.service.disconnect()
        self.settings = self.settings.model_copy(update={"sim_profile": profile})
        self.service = self._build_service()

    async def close(self) -> None:
        await self.service.disconnect()
