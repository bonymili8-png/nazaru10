"""Simulated physical vehicle state (engine, speed, temperatures, battery) and fault configuration."""

from __future__ import annotations

import math
import random
import time
from dataclasses import dataclass, field

from jlr_shared_types.models import IgnitionState


@dataclass(slots=True)
class SimulationFaults:
    """Fault injection switches. All default to a healthy vehicle."""

    disconnected: bool = False  # adapter unplugged: every bus operation raises
    battery_voltage: float | None = None  # override (e.g. 11.2 to simulate a weak battery)
    ignition_off: bool = False
    silent_ecus: set[int] = field(default_factory=set)  # ECU unavailable: request IDs that never answer
    corrupt_ecus: set[int] = field(default_factory=set)  # answer with an invalid UDS response
    response_pending: dict[int, int] = field(default_factory=dict)  # request ID -> number of 0x78 first
    response_delay: dict[int, float] = field(default_factory=dict)  # request ID -> seconds before answering
    interrupt_multiframe: set[int] = field(default_factory=set)  # stop after the first frame (N_Cr timeout)
    vin_override: dict[int, str] = field(default_factory=dict)  # request ID -> VIN (module from another car)

    def reset(self) -> None:
        self.disconnected = False
        self.battery_voltage = None
        self.ignition_off = False
        self.silent_ecus.clear()
        self.corrupt_ecus.clear()
        self.response_pending.clear()
        self.response_delay.clear()
        self.interrupt_multiframe.clear()
        self.vin_override.clear()

    def describe(self) -> dict[str, object]:
        return {
            "disconnected": self.disconnected,
            "battery_voltage": self.battery_voltage,
            "ignition_off": self.ignition_off,
            "silent_ecus": sorted(f"0x{i:03X}" for i in self.silent_ecus),
            "corrupt_ecus": sorted(f"0x{i:03X}" for i in self.corrupt_ecus),
            "response_pending": {f"0x{k:03X}": v for k, v in self.response_pending.items()},
            "response_delay": {f"0x{k:03X}": v for k, v in self.response_delay.items()},
            "interrupt_multiframe": sorted(f"0x{i:03X}" for i in self.interrupt_multiframe),
            "vin_override": {f"0x{k:03X}": v for k, v in self.vin_override.items()},
        }


class VehicleState:
    """Deterministic, smoothly varying signals (seeded), so tests and demos are repeatable."""

    def __init__(
        self,
        faults: SimulationFaults,
        seed: int = 7,
        *,
        engine_running: bool = True,
        odometer_km: float = 42_180.0,
    ) -> None:
        self.faults = faults
        self._rng = random.Random(seed)
        self._phase = self._rng.random() * math.tau
        self._start = time.monotonic()
        self.engine_running = engine_running
        self.odometer_km = odometer_km
        self.fuel_level = 63.0
        self.frozen_at: float | None = None

    def elapsed(self) -> float:
        return self.frozen_at if self.frozen_at is not None else time.monotonic() - self._start

    def _wave(self, period: float, offset: float = 0.0) -> float:
        return math.sin(self.elapsed() * math.tau / period + self._phase + offset)

    def ignition(self) -> IgnitionState:
        return IgnitionState.OFF if self.faults.ignition_off else IgnitionState.ON

    def battery_voltage(self) -> float:
        if self.faults.battery_voltage is not None:
            return self.faults.battery_voltage
        base = 14.1 if self.engine_running else 12.55
        return round(base + 0.05 * self._wave(9.0), 2)

    def engine_rpm(self) -> float:
        if not self.engine_running:
            return 0.0
        return max(650.0, 780 + 900 * max(0.0, self._wave(20.0)) + 25 * self._wave(1.7))

    def vehicle_speed(self) -> float:
        if not self.engine_running:
            return 0.0
        return max(0.0, 48 * max(0.0, self._wave(20.0, -0.4)))

    def coolant_temp(self) -> float:
        return min(90.0, 20 + self.elapsed() * 0.8) if self.engine_running else 20.0

    def oil_temp(self) -> float:
        return min(98.0, 20 + self.elapsed() * 0.6) if self.engine_running else 20.0

    def intake_air_temp(self) -> float:
        return 24 + 2 * self._wave(30.0)

    def ambient_temp(self) -> float:
        return 18.0

    def engine_load(self) -> float:
        return 18 + 30 * max(0.0, self._wave(20.0)) if self.engine_running else 0.0

    def throttle(self) -> float:
        return 12 + 35 * max(0.0, self._wave(20.0, 0.3)) if self.engine_running else 0.0

    def maf(self) -> float:
        return self.engine_rpm() / 160 if self.engine_running else 0.0

    def run_time(self) -> float:
        return self.elapsed() if self.engine_running else 0.0

    def fuel(self) -> float:
        return self.fuel_level

    def baro(self) -> float:
        return 101.0

    def transmission_temp(self) -> float:
        return min(82.0, 20 + self.elapsed() * 0.4) if self.engine_running else 20.0

    def ride_height_front(self) -> float:
        return 5.0 * self._wave(45.0)

    def suspension_pressure(self) -> float:
        return 14.5 + 0.3 * self._wave(12.0)

    def odometer(self) -> float:
        return self.odometer_km + self.elapsed() * self.vehicle_speed() / 3600

    def cabin_temp(self) -> float:
        return 21.5 + 0.5 * self._wave(60.0)
