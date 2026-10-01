"""Typed HTTP client for the diagnostic gateway.

Gateway errors arrive as ``{"error": {code, message, details}}`` and are re-raised as the same typed
:class:`DiagnosticError`, so a low-voltage block inside the gateway is a LowVoltageError here too.
"""

from __future__ import annotations

from typing import Any, TypeVar

import httpx
from pydantic import BaseModel, TypeAdapter

from jlr_diagnostic_core.observability import correlation_id_var
from jlr_shared_types.errors import (
    DiagnosticError,
    GatewayUnavailableError,
    ProtocolError,
    error_from_payload,
)
from jlr_shared_types.models import (
    ClearDtcResult,
    ConnectResult,
    InterfaceStatus,
    LiveDataSnapshot,
    LiveParameterDefinition,
    OperationRisk,
    SafetyDecision,
    ScanResult,
)
from jlr_shared_types.permissions import Permission

T = TypeVar("T", bound=BaseModel)


class GatewayStatus(BaseModel):
    interface: InterfaceStatus
    vin: str | None
    busy_with: str | None
    simulation: bool
    catalogs: list[dict[str, str]]
    protocol_version: str
    protocols: dict[str, str]


class GatewayClient:
    def __init__(
        self,
        base_url: str,
        token: str,
        *,
        timeout: float = 120.0,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._client = httpx.AsyncClient(
            base_url=base_url.rstrip("/"),
            headers={"X-Gateway-Token": token},
            timeout=httpx.Timeout(timeout, connect=5.0),
            transport=transport,
        )

    async def close(self) -> None:
        await self._client.aclose()

    async def _request(
        self, method: str, path: str, json: Any = None, *, timeout: float | None = None
    ) -> Any:
        headers = {}
        cid = correlation_id_var.get()
        if cid:
            headers["X-Correlation-ID"] = cid
        try:
            response = await self._client.request(
                method,
                path,
                json=json,
                headers=headers,
                timeout=timeout if timeout is not None else httpx.USE_CLIENT_DEFAULT,
            )
        except httpx.TimeoutException as exc:
            raise GatewayUnavailableError("Diagnostic gateway did not answer in time") from exc
        except httpx.HTTPError as exc:
            raise GatewayUnavailableError(f"Diagnostic gateway unreachable: {type(exc).__name__}") from exc
        if response.status_code >= 400:
            try:
                payload = response.json()["error"]
            except (ValueError, KeyError, TypeError):
                raise GatewayUnavailableError(f"Gateway returned HTTP {response.status_code}") from None
            raise error_from_payload(payload)
        try:
            return response.json()
        except ValueError as exc:
            raise ProtocolError("Gateway returned a non-JSON response") from exc

    async def _model(self, model: type[T], method: str, path: str, json: Any = None) -> T:
        data = await self._request(method, path, json)
        try:
            return model.model_validate(data)
        except ValueError as exc:
            raise ProtocolError(f"Gateway response does not match {model.__name__}") from exc

    async def health(self) -> dict[str, Any]:
        result: dict[str, Any] = await self._request("GET", "/health", timeout=5.0)
        return result

    async def status(self) -> GatewayStatus:
        return await self._model(GatewayStatus, "GET", "/gw/v1/status")

    async def connect(self) -> ConnectResult:
        return await self._model(ConnectResult, "POST", "/gw/v1/connect")

    async def disconnect(self) -> None:
        await self._request("POST", "/gw/v1/disconnect")

    async def scan(self) -> ScanResult:
        return await self._model(ScanResult, "POST", "/gw/v1/scan")

    async def live_parameters(self) -> list[LiveParameterDefinition]:
        data = await self._request("GET", "/gw/v1/live-data/parameters")
        return TypeAdapter(list[LiveParameterDefinition]).validate_python(data)

    async def read_live(self, parameter_ids: list[str]) -> LiveDataSnapshot:
        return await self._model(
            LiveDataSnapshot, "POST", "/gw/v1/live-data/read", {"parameter_ids": parameter_ids}
        )

    async def check_safety(self, operation: str, risk: OperationRisk) -> SafetyDecision:
        return await self._model(
            SafetyDecision, "POST", "/gw/v1/safety/check", {"operation": operation, "risk": risk.value}
        )

    async def clear_dtcs(
        self, ecu_id: str, *, expected_vin: str, confirm: bool, permissions: frozenset[Permission]
    ) -> ClearDtcResult:
        return await self._model(
            ClearDtcResult,
            "POST",
            "/gw/v1/dtcs/clear",
            {
                "ecu_id": ecu_id,
                "expected_vin": expected_vin,
                "confirm": confirm,
                "permissions": sorted(p.value for p in permissions),
            },
        )


__all__ = ["DiagnosticError", "GatewayClient", "GatewayStatus"]
