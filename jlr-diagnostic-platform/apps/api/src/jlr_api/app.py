"""FastAPI application factory for the public backend API (``/api/v1``)."""

from __future__ import annotations

import time
from collections.abc import AsyncIterator, Awaitable, Callable
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from prometheus_client import CONTENT_TYPE_LATEST, CollectorRegistry, Counter, Histogram, generate_latest
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker
from starlette.exceptions import HTTPException as StarletteHTTPException

from jlr_api.context import DEFAULT_LIMITS, AppContext
from jlr_api.db.base import create_engine, create_session_factory
from jlr_api.gateway_client import GatewayClient
from jlr_api.routes import auth, system, vehicles
from jlr_api.settings import ApiSettings
from jlr_diagnostic_core.observability import configure_logging, correlation_id_var, log_event, new_id
from jlr_security import RateLimiter
from jlr_shared_types.errors import DiagnosticError, ErrorCode, http_status_for

API_PREFIX = "/api/v1"


def _error(
    code: ErrorCode, message: str, status: int, details: dict[str, object] | None = None
) -> JSONResponse:
    return JSONResponse(
        {
            "error": {
                "code": code.value,
                "message": message,
                "details": details or {},
                "correlation_id": correlation_id_var.get(),
            }
        },
        status_code=status,
    )


def create_app(
    settings: ApiSettings | None = None,
    *,
    engine: AsyncEngine | None = None,
    sessions: async_sessionmaker[AsyncSession] | None = None,
    gateway: GatewayClient | None = None,
) -> FastAPI:
    settings = settings or ApiSettings()
    configure_logging(settings.log_level, json_output=settings.log_json)
    own_engine = engine is None and sessions is None
    engine = engine or create_engine(settings.database_url)
    sessions = sessions or create_session_factory(engine)
    gateway = gateway or GatewayClient(
        settings.gateway_url, settings.gateway_token, timeout=settings.gateway_timeout_seconds
    )
    context = AppContext(
        settings=settings, sessions=sessions, gateway=gateway, limiter=RateLimiter(DEFAULT_LIMITS)
    )

    registry = CollectorRegistry()
    requests_total = Counter(
        "jlr_api_requests_total", "HTTP requests", ["method", "route", "status"], registry=registry
    )
    latency = Histogram("jlr_api_request_seconds", "HTTP request latency", ["route"], registry=registry)

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        await gateway.close()
        if own_engine:
            await engine.dispose()

    app = FastAPI(
        title="JLR Diagnostic Platform API",
        version="0.1.0",
        lifespan=lifespan,
        docs_url=f"{API_PREFIX}/docs",
        openapi_url=f"{API_PREFIX}/openapi.json",
    )
    app.state.context = context

    origins = settings.cors_origin_list()
    if origins:
        app.add_middleware(
            CORSMiddleware,
            allow_origins=origins,
            allow_methods=["GET", "POST", "PATCH"],
            allow_headers=["Authorization", "Content-Type", "X-Correlation-ID"],
            expose_headers=["X-Correlation-ID"],
        )

    @app.middleware("http")
    async def observability(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        incoming = request.headers.get("x-correlation-id", "")
        cid = incoming if 8 <= len(incoming) <= 64 and incoming.isalnum() else new_id()
        token = correlation_id_var.set(cid)
        started = time.monotonic()
        try:
            response = await call_next(request)
        finally:
            correlation_id_var.reset(token)
        route = getattr(request.scope.get("route"), "path", "unmatched")
        requests_total.labels(request.method, route, str(response.status_code)).inc()
        latency.labels(route).observe(time.monotonic() - started)
        response.headers["X-Correlation-ID"] = cid
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.exception_handler(DiagnosticError)
    async def diagnostic_error(_: Request, exc: DiagnosticError) -> JSONResponse:
        status = http_status_for(exc.code)
        if status >= 500:
            log_event(40, "api.error", code=exc.code.value, error_message=exc.message)
        return _error(exc.code, exc.message, status, exc.details)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [
            {"loc": e.get("loc"), "msg": e.get("msg"), "type": e.get("type")} for e in exc.errors()[:20]
        ]
        return _error(ErrorCode.VALIDATION_ERROR, "Invalid request", 422, {"errors": errors})

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = ErrorCode.NOT_FOUND if exc.status_code == 404 else ErrorCode.VALIDATION_ERROR
        return _error(code, str(exc.detail), exc.status_code)

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception) -> JSONResponse:
        log_event(40, "api.unhandled", error=type(exc).__name__, error_message=str(exc))
        return _error(ErrorCode.INTERNAL_ERROR, "Internal error", 500)

    for router in (system.router, auth.router, vehicles.router):
        app.include_router(router, prefix=API_PREFIX)

    @app.get("/metrics", include_in_schema=False)
    async def metrics() -> Response:
        return Response(generate_latest(registry), media_type=CONTENT_TYPE_LATEST)

    return app
