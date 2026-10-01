"""VehicleSafetyChecker — preconditions for operations that change vehicle state.

Thresholds are conservative engineering defaults, configurable per deployment; they are not OEM
specifications. Read-only operations are never blocked by voltage (diagnosing a flat battery is a
legitimate use) but carry warnings.
"""

from __future__ import annotations

from dataclasses import dataclass

from jlr_shared_types.models import (
    IgnitionState,
    InterfaceStatus,
    OperationRisk,
    SafetyDecision,
    SafetyVerdict,
)


@dataclass(frozen=True, slots=True)
class SafetyThresholds:
    warn_voltage: float = 12.0
    min_voltage_low_risk: float = 11.5
    min_voltage_configuration: float = 12.2
    min_voltage_flashing: float = 12.8
    max_voltage: float = 15.5
    max_link_failures: int = 3


class VehicleSafetyChecker:
    def __init__(self, thresholds: SafetyThresholds | None = None) -> None:
        self.thresholds = thresholds or SafetyThresholds()

    def _min_voltage(self, risk: OperationRisk) -> float | None:
        t = self.thresholds
        return {
            OperationRisk.READ_ONLY: None,
            OperationRisk.LOW_RISK_WRITE: t.min_voltage_low_risk,
            OperationRisk.CONFIGURATION_WRITE: t.min_voltage_configuration,
            OperationRisk.FLASHING: t.min_voltage_flashing,
        }[risk]

    def evaluate(
        self,
        operation: str,
        risk: OperationRisk,
        status: InterfaceStatus,
        *,
        link_failures: int = 0,
        requires_oem_auth: bool = False,
    ) -> SafetyDecision:
        t = self.thresholds
        voltage = status.vehicle_voltage
        reasons: list[str] = []

        def decision(verdict: SafetyVerdict) -> SafetyDecision:
            allowed = verdict in (SafetyVerdict.ALLOWED, SafetyVerdict.ALLOWED_WITH_WARNINGS)
            return SafetyDecision(
                operation=operation,
                risk=risk,
                verdict=verdict,
                allowed=allowed,
                reasons=reasons,
                vehicle_voltage=voltage,
                ignition=status.ignition,
            )

        if not status.connected:
            reasons.append("Interface is not connected to the vehicle")
            return decision(SafetyVerdict.BLOCKED_NOT_CONNECTED)
        if requires_oem_auth:
            reasons.append("The target ECU requires OEM authentication the platform does not hold")
            return decision(SafetyVerdict.REQUIRES_OEM_AUTH)

        minimum = self._min_voltage(risk)
        if risk is not OperationRisk.READ_ONLY:
            if link_failures >= t.max_link_failures:
                reasons.append(
                    f"{link_failures} consecutive communication failures with known ECUs: link is unstable"
                )
                return decision(SafetyVerdict.BLOCKED_UNSTABLE_CONNECTION)
            if voltage is None:
                if risk in (OperationRisk.CONFIGURATION_WRITE, OperationRisk.FLASHING):
                    reasons.append("Vehicle voltage cannot be measured with this interface")
                    return decision(SafetyVerdict.BLOCKED_VOLTAGE_UNKNOWN)
                reasons.append("Vehicle voltage unknown; proceed only with a stable supply")
            elif minimum is not None and voltage < minimum:
                reasons.append(
                    f"Vehicle voltage {voltage:.2f} V is below {minimum:.1f} V required for {risk.value}"
                )
                return decision(SafetyVerdict.BLOCKED_LOW_VOLTAGE)
            if voltage is not None and voltage > t.max_voltage:
                reasons.append(f"Vehicle voltage {voltage:.2f} V is above {t.max_voltage:.1f} V")
                return decision(SafetyVerdict.BLOCKED_HIGH_VOLTAGE)
            if status.ignition is IgnitionState.OFF:
                reasons.append("Ignition is off")
                return decision(SafetyVerdict.BLOCKED_IGNITION_OFF)
            if status.ignition is IgnitionState.UNKNOWN:
                if risk is OperationRisk.FLASHING:
                    reasons.append("Ignition state cannot be determined")
                    return decision(SafetyVerdict.BLOCKED_IGNITION_OFF)
                reasons.append("Ignition state unknown")
        if voltage is not None and voltage < t.warn_voltage:
            reasons.append(f"Low battery: {voltage:.2f} V — connect a battery support unit for long sessions")
        return decision(SafetyVerdict.ALLOWED_WITH_WARNINGS if reasons else SafetyVerdict.ALLOWED)
