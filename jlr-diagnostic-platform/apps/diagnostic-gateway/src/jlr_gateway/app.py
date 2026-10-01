"""Diagnostic gateway HTTP service (internal API, consumed by the backend only).

The gateway runs next to the vehicle and owns the physical connection. Every route except
``/health`` requires the shared ``X-Gateway-Token``.
"""

from __future__ import annotations

import hmac
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager
from typing import Annotated, Any

from fastapi import Depends, FastAPI, Header, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Histogram, generate_latest
from pydantic import BaseModel, ConfigDict, Field

from jlr_diagnostic_core.observability import (
    configure_logging,
    correlation_id_var,
    new_id,
    register_metrics_sink,
)
from jlr_gateway.runtime import GatewayRuntime
from jlr_gateway.settings import GatewaySettings
from jlr_protocols import PROTOCOL_VERSIONS
from jlr_shared_types.errors import (
    AuthRequiredError,
    DiagnosticError,
    ErrorCode,
    UnsupportedOperationError,
    http_status_for,
)
from jlr_shared_types.models import (
    GATEWAY_PROTOCOL_VERSION,
    ClearDtcResult,
    ConnectResult,
    InterfaceStatus,
    LiveDataSnapshot,
    LiveParameterDefinition,
    OperationRisk,
    SafetyDecision,
    ScanResult,
    VehicleIdentity,
)
from jlr_shared_types.permissions import Permission
from jlr_simulator import JLRVehicleSimulator


class _Metrics:
    def __init__(self, registry: CollectorRegistry) -> None:
        self.histogram = Histogram(
            "jlr_gateway_operation_seconds",
            "Diagnostic operation duration",
            ["operation", "outcome"],
            registry=registry,
        )

    def observe_operation(self, name: str, outcome: str, seconds: float) -> None:
        self.histogram.labels(name, outcome).observe(seconds)


class StatusResponse(BaseModel):
    interface: InterfaceStatus
    vin: str | None
    busy_with: str | None
    simulation: bool
    catalogs: list[dict[str, str]]
    protocol_version: str = GATEWAY_PROTOCOL_VERSION
    protocols: dict[str, str] = Field(default_factory=lambda: dict(PROTOCOL_VERSIONS))


class LiveReadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    parameter_ids: list[str] = Field(min_length=1, max_length=64)


class SafetyCheckRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    operation: str = Field(min_length=1, max_length=64)
    risk: OperationRisk


class ClearDtcRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    ecu_id: str = Field(min_length=1, max_length=16)
    expected_vin: str = Field(min_length=17, max_length=17)
    confirm: bool
    permissions: list[Permission]


class FaultUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    disconnected: bool | None = None
    battery_voltage: float | None = Field(default=None, ge=0, le=30)
    clear_battery_override: bool = False
    ignition_off: bool | None = None
    silent_ecus: list[str] | None = None
    corrupt_ecus: list[str] | None = None
    response_pending: dict[str, int] | None = None
    response_delay: dict[str, float] | None = None
    interrupt_multiframe: list[str] | None = None
    vin_override: dict[str, str] | None = None


class ProfileRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profile: str


def _hex_ids(values: list[str]) -> set[int]:
    return {int(v, 16) for v in values}


def create_app(settings: GatewaySettings | None = None) -> FastAPI:
    settings = settings or GatewaySettings()
    configure_logging(settings.log_level, json_output=settings.log_json)
    registry = CollectorRegistry()
    register_metrics_sink(_Metrics(registry))
    runtime = GatewayRuntime(settings)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        await runtime.close()

    app = FastAPI(
        title="JLR Diagnostic Gateway",
        version="0.1.0",
        lifespan=lifespan,
        docs_url="/gw/docs",
        openapi_url="/gw/openapi.json",
    )
    app.state.runtime = runtime

    @app.middleware("http")
    async def correlation(request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        incoming = request.headers.get("x-correlation-id", "")
        cid = incoming if 8 <= len(incoming) <= 64 and incoming.isascii() else new_id()
        token = correlation_id_var.set(cid)
        try:
            response = await call_next(request)
        finally:
            correlation_id_var.reset(token)
        response.headers["X-Correlation-ID"] = cid
        return response

    @app.exception_handler(DiagnosticError)
    async def diagnostic_error(_: Request, exc: DiagnosticError) -> JSONResponse:
        return JSONResponse(
            {"error": {**exc.to_payload(), "correlation_id": correlation_id_var.get()}},
            status_code=http_status_for(exc.code),
        )

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        return JSONResponse(
            {
                "error": {
                    "code": ErrorCode.VALIDATION_ERROR.value,
                    "message": "Invalid request",
                    "details": {"errors": exc.errors()[:20]},
                    "correlation_id": correlation_id_var.get(),
                }
            },
            status_code=422,
        )

    def require_token(
        x_gateway_token: Annotated[str | None, Header()] = None,
        authorization: Annotated[str | None, Header()] = None,
    ) -> None:
        presented = x_gateway_token or (authorization or "").removeprefix("Bearer ").strip()
        if not presented or not hmac.compare_digest(presented.encode(), settings.token.encode()):
            raise AuthRequiredError("Missing or invalid gateway token")

    def rt() -> GatewayRuntime:
        runtime_: GatewayRuntime = app.state.runtime
        return runtime_

    def simulator() -> JLRVehicleSimulator:
        r = rt()
        if r.simulator is None:
            raise UnsupportedOperationError("Simulator controls are only available with the mock interface")
        if not settings.sim_control_enabled:
            raise UnsupportedOperationError(
                "Simulator controls are disabled (GATEWAY_SIM_CONTROL_ENABLED=false)"
            )
        return r.simulator

    auth = Depends(require_token)

    @app.get("/health")
    async def health() -> dict[str, Any]:
        r = rt()
        return {
            "status": "ok",
            "interface": settings.interface,
            "simulation": r.simulation,
            "protocol_version": GATEWAY_PROTOCOL_VERSION,
        }

    @app.get("/metrics", dependencies=[auth])
    async def metrics() -> Response:
        return Response(generate_latest(registry), media_type=CONTENT_TYPE_LATEST)

    @app.get("/gw/v1/status", dependencies=[auth])
    async def status() -> StatusResponse:
        r = rt()
        return StatusResponse(
            interface=await r.service.status(),
            vin=r.service.identity.vin if r.service.identity else None,
            busy_with=r.service.busy_with,
            simulation=r.simulation,
            catalogs=r.service.catalog.describe(),
        )

    @app.post("/gw/v1/connect", dependencies=[auth])
    async def connect() -> ConnectResult:
        return await rt().service.connect()

    @app.post("/gw/v1/disconnect", dependencies=[auth])
    async def disconnect() -> dict[str, bool]:
        await rt().service.disconnect()
        return {"connected": False}

    @app.post("/gw/v1/identify", dependencies=[auth])
    async def identify() -> VehicleIdentity:
        return await rt().service.identify_vehicle()

    @app.post("/gw/v1/scan", dependencies=[auth])
    async def scan() -> ScanResult:
        return await rt().service.full_scan()

    @app.get("/gw/v1/live-data/parameters", dependencies=[auth])
    async def live_parameters() -> list[LiveParameterDefinition]:
        return await rt().service.live_parameters()

    @app.post("/gw/v1/live-data/read", dependencies=[auth])
    async def live_read(body: LiveReadRequest) -> LiveDataSnapshot:
        return await rt().service.read_live(body.parameter_ids)

    @app.post("/gw/v1/safety/check", dependencies=[auth])
    async def safety_check(body: SafetyCheckRequest) -> SafetyDecision:
        return await rt().service.check_safety(body.operation, body.risk)

    @app.post("/gw/v1/dtcs/clear", dependencies=[auth])
    async def clear_dtcs(body: ClearDtcRequest) -> ClearDtcResult:
        return await rt().service.clear_dtcs(
            body.ecu_id,
            expected_vin=body.expected_vin,
            permissions=frozenset(body.permissions),
            confirm=body.confirm,
        )

    # ------------------------------------------------------------------ simulator controls

    @app.get("/gw/v1/simulator", dependencies=[auth])
    async def simulator_state() -> dict[str, Any]:
        sim = simulator()
        return {**sim.describe(), "profiles": JLRVehicleSimulator.available_profiles()}

    @app.post("/gw/v1/simulator/profile", dependencies=[auth])
    async def simulator_profile(body: ProfileRequest) -> dict[str, Any]:
        simulator()
        if body.profile not in {p["key"] for p in JLRVehicleSimulator.available_profiles()}:
            raise UnsupportedOperationError(f"Unknown simulation profile {body.profile!r}")
        await rt().switch_simulation_profile(body.profile)
        return simulator().describe()

    @app.post("/gw/v1/simulator/faults", dependencies=[auth])
    async def simulator_faults(body: FaultUpdate) -> dict[str, Any]:
        sim = simulator()
        f = sim.faults
        if body.disconnected is True:
            sim.disconnect_adapter()
        elif body.disconnected is False:
            sim.reconnect_adapter()
        if body.clear_battery_override:
            f.battery_voltage = None
        elif body.battery_voltage is not None:
            f.battery_voltage = body.battery_voltage
        if body.ignition_off is not None:
            f.ignition_off = body.ignition_off
        if body.silent_ecus is not None:
            f.silent_ecus = _hex_ids(body.silent_ecus)
        if body.corrupt_ecus is not None:
            f.corrupt_ecus = _hex_ids(body.corrupt_ecus)
        if body.interrupt_multiframe is not None:
            f.interrupt_multiframe = _hex_ids(body.interrupt_multiframe)
        if body.response_pending is not None:
            f.response_pending = {int(k, 16): v for k, v in body.response_pending.items()}
        if body.response_delay is not None:
            f.response_delay = {int(k, 16): v for k, v in body.response_delay.items()}
        if body.vin_override is not None:
            f.vin_override = {int(k, 16): v for k, v in body.vin_override.items()}
        return sim.describe()

    @app.post("/gw/v1/simulator/faults/reset", dependencies=[auth])
    async def simulator_reset() -> dict[str, Any]:
        sim = simulator()
        sim.faults.reset()
        return sim.describe()

    return app
