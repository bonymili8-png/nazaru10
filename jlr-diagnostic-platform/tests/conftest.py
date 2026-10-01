"""Shared fixtures: simulator-backed diagnostic service, gateway app and API app wired in-process."""

from __future__ import annotations

import os
from collections.abc import AsyncIterator, Callable
from typing import Any

import httpx
import pytest

from jlr_diagnostic_core import (
    SAE_GENERIC_CATALOG,
    CatalogSet,
    DiagnosticService,
    DiscoveryConfig,
    ServiceConfig,
)
from jlr_simulator import JLRVehicleSimulator

GATEWAY_TOKEN = "test-gateway-token-0123456789"
JWT_SECRET = "test-jwt-secret-0123456789abcdef0123456789"
BOT_TOKEN = "123456:TEST-bot-token"

FAST_DISCOVERY = DiscoveryConfig(probe_timeout=0.01, concurrency=8, passive_listen=0.01)


def make_service(simulator: JLRVehicleSimulator, **config: Any) -> DiagnosticService:
    return DiagnosticService(
        simulator.create_interface(),
        catalog=CatalogSet([simulator.catalog(), SAE_GENERIC_CATALOG]),
        config=ServiceConfig(discovery=FAST_DISCOVERY, functional_timeout=0.05, **config),
        profile_overrides=simulator.profile_overrides(),
    )


@pytest.fixture
def simulator() -> JLRVehicleSimulator:
    return JLRVehicleSimulator("range_rover")


@pytest.fixture
async def service(simulator: JLRVehicleSimulator) -> AsyncIterator[DiagnosticService]:
    svc = make_service(simulator)
    yield svc
    await svc.disconnect()


@pytest.fixture
async def connected(service: DiagnosticService) -> DiagnosticService:
    await service.connect()
    return service


def gateway_settings(**overrides: Any) -> Any:
    from jlr_gateway.settings import GatewaySettings

    values: dict[str, Any] = {
        "token": GATEWAY_TOKEN,
        "probe_timeout": 0.01,
        "discovery_concurrency": 8,
        "passive_listen": 0.01,
        "log_json": False,
        "log_level": "WARNING",
    }
    values.update(overrides)
    return GatewaySettings(**values)


@pytest.fixture
async def gateway_app() -> AsyncIterator[Any]:
    from jlr_gateway.app import create_app

    app = create_app(gateway_settings())
    # Faster functional timeouts for tests
    app.state.runtime.service.config = ServiceConfig(discovery=FAST_DISCOVERY, functional_timeout=0.05)
    yield app
    await app.state.runtime.close()


@pytest.fixture
async def gateway_client(gateway_app: Any) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=gateway_app),
        base_url="http://gateway",
        headers={"X-Gateway-Token": GATEWAY_TOKEN},
    ) as client:
        yield client


def database_url() -> str:
    return os.environ.get("TEST_DATABASE_URL", "sqlite+aiosqlite:///:memory:")


@pytest.fixture
async def api_app(gateway_app: Any) -> AsyncIterator[Any]:
    from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
    from sqlalchemy.pool import StaticPool

    from jlr_api.app import create_app
    from jlr_api.db.base import Base
    from jlr_api.gateway_client import GatewayClient
    from jlr_api.settings import ApiSettings

    url = database_url()
    if url.startswith("sqlite"):
        engine = create_async_engine(url, poolclass=StaticPool, connect_args={"check_same_thread": False})
        async with engine.begin() as conn:
            await conn.run_sync(Base.metadata.create_all)
    else:
        engine = create_async_engine(url)
        async with engine.begin() as conn:
            for table in reversed(Base.metadata.sorted_tables):
                if table.name == "audit_logs":
                    await conn.exec_driver_sql("ALTER TABLE audit_logs DISABLE TRIGGER USER")
                await conn.exec_driver_sql(f"DELETE FROM {table.name}")  # noqa: S608 - names from metadata
                if table.name == "audit_logs":
                    await conn.exec_driver_sql("ALTER TABLE audit_logs ENABLE TRIGGER USER")
    settings = ApiSettings(
        environment="test",
        database_url=url,
        jwt_secret=JWT_SECRET,
        telegram_bot_token=BOT_TOKEN,
        allow_dev_auth=True,
        default_role="technician",
        admin_telegram_ids="999",
        gateway_url="http://gateway",
        gateway_token=GATEWAY_TOKEN,
        log_json=False,
        log_level="WARNING",
    )
    gateway = GatewayClient("http://gateway", GATEWAY_TOKEN, transport=httpx.ASGITransport(app=gateway_app))
    app = create_app(
        settings, engine=engine, sessions=async_sessionmaker(engine, expire_on_commit=False), gateway=gateway
    )
    yield app
    await gateway.close()
    await engine.dispose()


@pytest.fixture
async def api(api_app: Any) -> AsyncIterator[httpx.AsyncClient]:
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=api_app), base_url="http://api") as client:
        yield client


Login = Callable[..., Any]


@pytest.fixture
def login(api: httpx.AsyncClient) -> Login:
    async def _login(telegram_id: int = 100_000_001, username: str = "tech") -> dict[str, str]:
        response = await api.post("/api/v1/auth/dev", json={"telegram_id": telegram_id, "username": username})
        assert response.status_code == 200, response.text
        return {"Authorization": f"Bearer {response.json()['access_token']}"}

    return _login
