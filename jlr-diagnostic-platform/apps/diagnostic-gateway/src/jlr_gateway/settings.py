"""Gateway configuration (environment variables, prefix ``GATEWAY_``)."""

from __future__ import annotations

from typing import Literal

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class GatewaySettings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="GATEWAY_", env_file=".env", extra="ignore")

    interface: Literal["mock", "socketcan", "doip", "j2534"] = "mock"
    token: str = Field(min_length=16, description="Shared secret the API presents in X-Gateway-Token")
    log_level: str = "INFO"
    log_json: bool = True

    # Simulator (interface=mock)
    sim_profile: str = "range_rover"
    sim_seed: int = 7
    sim_can_fd: bool = False
    sim_control_enabled: bool = True

    # SocketCAN
    socketcan_channel: str = "can0"
    socketcan_fd: bool = False

    # DoIP
    doip_host: str = "127.0.0.1"
    doip_port: int = 13400
    doip_targets: str = ""  # comma-separated hex logical addresses, e.g. "0x1010,0x1011"
    doip_functional_address: str = ""

    # J2534
    j2534_library: str = ""

    # Discovery (CAN address plan heuristic, see docs/PROTOCOLS.md)
    address_range_start: int = 0x700
    address_range_end: int = 0x7F7
    response_offset: int = 8
    probe_timeout: float = 0.05
    discovery_concurrency: int = Field(default=4, ge=1, le=8)
    passive_listen: float = 0.2
    scan_concurrency: int = Field(default=2, ge=1, le=4)

    # Operator-verified definition catalogs (JSON); see docs/PROTOCOLS.md#catalogs
    catalog_dir: str = ""

    # Safety thresholds (V)
    safety_min_voltage_low_risk: float = 11.5
    safety_min_voltage_configuration: float = 12.2
    safety_min_voltage_flashing: float = 12.8

    @field_validator("token")
    @classmethod
    def _not_placeholder(cls, value: str) -> str:
        if value.lower().startswith("change-me"):
            raise ValueError("GATEWAY_TOKEN still has the placeholder value")
        return value

    def doip_target_list(self) -> list[int]:
        return [int(v.strip(), 16) for v in self.doip_targets.split(",") if v.strip()]
