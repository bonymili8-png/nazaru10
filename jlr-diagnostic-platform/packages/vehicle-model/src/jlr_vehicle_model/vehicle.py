"""Version-aware vehicle profile.

Every attribute is a :class:`ProfileFact` carrying its value *and* where the value came from. A
profile built purely from a bus scan knows the VIN (ECU response), the manufacturer (registered WMI)
and the model-year (ISO 3779 code); model, engine, transmission and market stay UNKNOWN until a
verified source provides them. Simulator profiles fill them with ``source=SIMULATION``.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from jlr_shared_types.models import VEHICLE_PROFILE_SCHEMA_VERSION, EvidenceSource
from jlr_vehicle_model.vin import decode_vin


class ProfileFact(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    value: str | int | None = None
    source: EvidenceSource = EvidenceSource.NONE
    note: str | None = None

    @property
    def known(self) -> bool:
        return self.value is not None


class VehicleProfile(BaseModel):
    model_config = ConfigDict(frozen=True, extra="forbid")

    schema_version: str = VEHICLE_PROFILE_SCHEMA_VERSION
    vin: str
    make: ProfileFact = Field(default_factory=ProfileFact)
    model: ProfileFact = Field(default_factory=ProfileFact)
    model_year: ProfileFact = Field(default_factory=ProfileFact)
    engine: ProfileFact = Field(default_factory=ProfileFact)
    transmission: ProfileFact = Field(default_factory=ProfileFact)
    market: ProfileFact = Field(default_factory=ProfileFact)
    simulation_profile: str | None = None
    warnings: list[str] = Field(default_factory=list)

    def display_name(self) -> str:
        parts = [str(p.value) for p in (self.model_year, self.make, self.model) if p.known]
        return " ".join(parts) if parts else self.vin


def build_profile(vin: str, *, overrides: dict[str, Any] | None = None) -> VehicleProfile:
    """Profile from what a VIN proves, optionally merged with facts from another evidence source.

    ``overrides`` maps attribute name to ``{"value": ..., "source": EvidenceSource, "note": ...}``;
    it is how a simulator profile or (later) an operator-verified build sheet adds model data.
    """

    decoded = decode_vin(vin)
    facts: dict[str, Any] = {
        "vin": decoded.vin,
        "warnings": list(decoded.warnings),
    }
    if decoded.manufacturer:
        facts["make"] = ProfileFact(
            value=decoded.manufacturer, source=EvidenceSource.ISO_STANDARD, note=f"WMI {decoded.wmi}"
        )
    if decoded.model_year:
        note = "ISO 3779 year code"
        if len(decoded.model_year_candidates) > 1:
            note += f"; 30-year cycle candidates {decoded.model_year_candidates}"
        facts["model_year"] = ProfileFact(
            value=decoded.model_year, source=EvidenceSource.HEURISTIC, note=note
        )
    simulation_profile = None
    for key, raw in (overrides or {}).items():
        if key == "simulation_profile":
            simulation_profile = str(raw)
            continue
        if key not in VehicleProfile.model_fields or key in {"vin", "schema_version", "warnings"}:
            continue
        facts[key] = ProfileFact.model_validate(raw)
    return VehicleProfile(simulation_profile=simulation_profile, **facts)
