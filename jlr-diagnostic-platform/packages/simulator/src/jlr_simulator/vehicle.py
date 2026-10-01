"""JLRVehicleSimulator — a complete simulated vehicle behind a mock diagnostic interface."""

from __future__ import annotations

from typing import Any

from jlr_diagnostic_core.catalog import DefinitionCatalog, DidParameter, OccurrenceRecord
from jlr_diagnostic_core.transports.can import CANInterface
from jlr_protocols.isotp import IsoTpConfig
from jlr_protocols.uds import dtc_code
from jlr_shared_types.models import EvidenceSource, IgnitionState, InterfaceKind
from jlr_simulator.bus import SimulatedCanBus, VirtualCanNetwork
from jlr_simulator.ecu import SimulatedEcu
from jlr_simulator.profiles import PROFILES, SimulationProfile
from jlr_simulator.state import SimulationFaults, VehicleState


class JLRVehicleSimulator:
    def __init__(self, profile: str = "range_rover", *, seed: int = 7, fd: bool = False) -> None:
        if profile not in PROFILES:
            raise ValueError(f"Unknown simulation profile {profile!r}; choose from {sorted(PROFILES)}")
        self.profile: SimulationProfile = PROFILES[profile]
        self.faults = SimulationFaults()
        self.state = VehicleState(self.faults, seed)
        self.isotp = IsoTpConfig(tx_dl=64 if fd else 8, timeout_n_bs=0.5, timeout_n_cr=0.5)
        self.ecus = [SimulatedEcu(spec, self) for spec in self.profile.ecus]
        self.network = VirtualCanNetwork(self.ecus, self.faults, self.isotp)

    @staticmethod
    def available_profiles() -> list[dict[str, str]]:
        return [{"key": p.key, "title": p.title, "vin": p.vin} for p in PROFILES.values()]

    @property
    def vin(self) -> str:
        return self.profile.vin

    def ecu(self, key: str) -> SimulatedEcu:
        for ecu in self.ecus:
            if ecu.spec.key == key:
                return ecu
        raise KeyError(key)

    def ecu_by_doip_address(self, address: int) -> SimulatedEcu | None:
        return next((e for e in self.ecus if e.spec.doip_address == address), None)

    # ------------------------------------------------------------------ fault helpers

    def disconnect_adapter(self) -> None:
        self.faults.disconnected = True
        self.network.signal_disconnect()

    def reconnect_adapter(self) -> None:
        self.faults.disconnected = False

    # ------------------------------------------------------------------ platform integration

    def create_bus(self) -> SimulatedCanBus:
        return SimulatedCanBus(self.network)

    def create_interface(self, *, address_plan: Any = None) -> CANInterface:
        """The ``MockInterface``: the production CAN interface over the simulated bus."""

        async def voltage() -> float | None:
            return self.state.battery_voltage()

        async def ignition() -> IgnitionState:
            return self.state.ignition()

        return CANInterface(
            self.create_bus(),
            kind=InterfaceKind.MOCK,
            description=f"Simulator: {self.profile.title}",
            isotp=IsoTpConfig(tx_dl=self.isotp.tx_dl),
            address_plan=address_plan,
            voltage_provider=voltage,
            ignition_provider=ignition,
            voltage_source="SIMULATION",
            simulation=True,
        )

    def catalog(self) -> DefinitionCatalog:
        """Definitions matching this profile's invented DIDs and manufacturer codes (SIMULATION source)."""

        descriptions: dict[str, str] = {}
        dids: dict[int, list[DidParameter]] = {}
        occurrence: dict[int, OccurrenceRecord] = {}
        for spec in self.profile.ecus:
            for d in spec.dtcs:
                if d.description:
                    descriptions[dtc_code(d.dtc)] = d.description
            if spec.live_dids:
                dids[spec.request_id] = [
                    DidParameter(
                        did=d.did,
                        name=d.name,
                        unit=d.unit,
                        length=d.length,
                        scale=d.scale,
                        offset=d.offset,
                        signed=d.signed,
                        min_value=d.min_value,
                        max_value=d.max_value,
                    )
                    for d in spec.live_dids
                ]
            occurrence[spec.request_id] = OccurrenceRecord(record_number=0x01, length=1)
        return DefinitionCatalog(
            name=f"Simulation catalog: {self.profile.title}",
            version="sim-1",
            source=EvidenceSource.SIMULATION,
            dtc_descriptions=descriptions,
            did_parameters=dids,
            occurrence_records=occurrence,
        )

    def profile_overrides(self) -> dict[str, Any]:
        overrides: dict[str, Any] = {"simulation_profile": self.profile.key}
        for key, value in self.profile.facts.items():
            overrides[key] = {
                "value": value,
                "source": EvidenceSource.SIMULATION.value,
                "note": "Simulation profile fact",
            }
        return overrides

    def describe(self) -> dict[str, Any]:
        return {
            "profile": self.profile.key,
            "title": self.profile.title,
            "vin": self.vin,
            "ecus": [
                {
                    "key": e.spec.key,
                    "name": e.spec.name,
                    "request_id": f"0x{e.spec.request_id:03X}",
                    "dtc_count": len(e.dtcs),
                }
                for e in self.ecus
            ],
            "faults": self.faults.describe(),
            "battery_voltage": self.state.battery_voltage(),
            "ignition": self.state.ignition().value,
        }


def MockInterface(simulator: JLRVehicleSimulator | None = None) -> CANInterface:  # noqa: N802 - interface factory
    return (simulator or JLRVehicleSimulator()).create_interface()
