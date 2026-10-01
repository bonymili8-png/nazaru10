"""Diagnostic gateway HTTP service."""

from __future__ import annotations

import httpx
import pytest
from fastapi import FastAPI

from tests.conftest import GATEWAY_TOKEN


async def test_health_is_public(gateway_app: FastAPI) -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=gateway_app), base_url="http://gw"
    ) as client:
        response = await client.get("/health")
    assert response.status_code == 200
    assert response.json()["simulation"] is True


@pytest.mark.parametrize(
    "headers", [{}, {"X-Gateway-Token": "wrong-token-wrong-token"}, {"Authorization": "Bearer nope"}]
)
async def test_token_required(gateway_app: FastAPI, headers: dict[str, str]) -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=gateway_app), base_url="http://gw"
    ) as client:
        response = await client.post("/gw/v1/connect", headers=headers)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


async def test_bearer_token_accepted(gateway_app: FastAPI) -> None:
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=gateway_app), base_url="http://gw"
    ) as client:
        response = await client.get("/gw/v1/status", headers={"Authorization": f"Bearer {GATEWAY_TOKEN}"})
    assert response.status_code == 200


async def test_connect_scan_live_flow(gateway_client: httpx.AsyncClient) -> None:
    status = (await gateway_client.get("/gw/v1/status")).json()
    assert status["interface"]["connected"] is False
    assert status["protocol_version"] == "gateway-api/1"
    connect = await gateway_client.post("/gw/v1/connect")
    assert connect.status_code == 200
    vin = connect.json()["identity"]["vin"]
    scan = (await gateway_client.post("/gw/v1/scan")).json()
    assert scan["vehicle"]["vin"] == vin
    assert len(scan["ecus"]) == 9
    parameters = (await gateway_client.get("/gw/v1/live-data/parameters")).json()
    ids = [p["id"] for p in parameters][:5]
    snapshot = (await gateway_client.post("/gw/v1/live-data/read", json={"parameter_ids": ids})).json()
    assert len(snapshot["values"]) == 5
    assert snapshot["vin"] == vin
    assert response_header_ok(
        await gateway_client.get("/gw/v1/status", headers={"X-Correlation-ID": "abcdef123456"})
    )


def response_header_ok(response: httpx.Response) -> bool:
    return response.headers["X-Correlation-ID"] == "abcdef123456"


async def test_structured_errors(gateway_client: httpx.AsyncClient) -> None:
    response = await gateway_client.post("/gw/v1/scan")
    assert response.status_code == 409
    body = response.json()["error"]
    assert body["code"] == "NOT_CONNECTED"
    assert body["correlation_id"]
    invalid = await gateway_client.post("/gw/v1/live-data/read", json={"parameter_ids": []})
    assert invalid.status_code == 422
    assert invalid.json()["error"]["code"] == "VALIDATION_ERROR"


async def test_simulator_fault_controls(gateway_client: httpx.AsyncClient) -> None:
    await gateway_client.post("/gw/v1/connect")
    state = (
        await gateway_client.post(
            "/gw/v1/simulator/faults", json={"battery_voltage": 11.0, "silent_ecus": ["0x760"]}
        )
    ).json()
    assert state["battery_voltage"] == 11.0
    assert state["faults"]["silent_ecus"] == ["0x760"]
    decision = (
        await gateway_client.post(
            "/gw/v1/safety/check", json={"operation": "clear_dtc", "risk": "LOW_RISK_WRITE"}
        )
    ).json()
    assert decision["verdict"] == "BLOCKED_LOW_VOLTAGE"
    scan = (await gateway_client.post("/gw/v1/scan")).json()
    assert "0x760" not in {e["id"] for e in scan["ecus"]}
    reset = (await gateway_client.post("/gw/v1/simulator/faults/reset")).json()
    assert reset["faults"]["silent_ecus"] == []


async def test_simulator_profile_switch(gateway_client: httpx.AsyncClient) -> None:
    profiles = (await gateway_client.get("/gw/v1/simulator")).json()["profiles"]
    assert {p["key"] for p in profiles} >= {"range_rover", "defender", "evoque"}
    switched = (await gateway_client.post("/gw/v1/simulator/profile", json={"profile": "evoque"})).json()
    assert switched["profile"] == "evoque"
    connect = (await gateway_client.post("/gw/v1/connect")).json()
    assert connect["identity"]["vin"] == switched["vin"]
    bad = await gateway_client.post("/gw/v1/simulator/profile", json={"profile": "nope"})
    assert bad.status_code == 422


async def test_metrics_requires_token(gateway_client: httpx.AsyncClient, gateway_app: FastAPI) -> None:
    await gateway_client.post("/gw/v1/connect")
    metrics = await gateway_client.get("/metrics")
    assert metrics.status_code == 200
    assert "jlr_gateway_operation_seconds" in metrics.text
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=gateway_app), base_url="http://gw"
    ) as anonymous:
        assert (await anonymous.get("/metrics")).status_code == 401


def test_placeholder_token_rejected() -> None:
    from pydantic import ValidationError

    from jlr_gateway.settings import GatewaySettings

    with pytest.raises(ValidationError):
        GatewaySettings(token="change-me-change-me-change-me")
    with pytest.raises(ValidationError):
        GatewaySettings(token="short")
