"""Public REST API: every endpoint, wired to the real gateway app and simulator in-process."""

from __future__ import annotations

import json
from datetime import UTC, datetime
from typing import Any
from urllib.parse import urlencode

import httpx
import pytest

from jlr_security import compute_init_data_hash
from tests.conftest import BOT_TOKEN, Login, database_url

API = "/api/v1"


async def connect(api: httpx.AsyncClient, headers: dict[str, str]) -> dict[str, Any]:
    response = await api.post(f"{API}/vehicles/connect", headers=headers)
    assert response.status_code == 200, response.text
    return response.json()  # type: ignore[no-any-return]


async def connect_and_scan(api: httpx.AsyncClient, headers: dict[str, str]) -> tuple[str, dict[str, Any]]:
    vehicle_id = (await connect(api, headers))["vehicle"]["id"]
    scan = await api.post(f"{API}/vehicles/{vehicle_id}/scan", headers=headers)
    assert scan.status_code == 200, scan.text
    return vehicle_id, scan.json()


# ------------------------------------------------------------------ system & auth


async def test_health_and_ready(api: httpx.AsyncClient) -> None:
    assert (await api.get(f"{API}/health")).json() == {"status": "ok"}
    ready = (await api.get(f"{API}/ready")).json()
    assert ready["database"] == "ok"
    assert ready["gateway"]["reachable"] is True
    metrics = await api.get("/metrics")
    assert "jlr_api_requests_total" in metrics.text


async def test_telegram_login(api: httpx.AsyncClient) -> None:
    fields = {
        "user": json.dumps({"id": 777, "first_name": "Ann", "username": "ann"}),
        "auth_date": str(int(datetime.now(UTC).timestamp())),
    }
    fields["hash"] = compute_init_data_hash(fields, BOT_TOKEN)
    response = await api.post(f"{API}/auth/telegram", json={"init_data": urlencode(fields)})
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["user"]["telegram_id"] == 777
    assert body["user"]["role"] == "technician"
    me = await api.get(f"{API}/me", headers={"Authorization": f"Bearer {body['access_token']}"})
    assert me.json()["username"] == "ann"


async def test_telegram_login_rejects_forged_data(api: httpx.AsyncClient) -> None:
    fields = {
        "user": json.dumps({"id": 1}),
        "auth_date": str(int(datetime.now(UTC).timestamp())),
        "hash": "00" * 32,
    }
    response = await api.post(f"{API}/auth/telegram", json={"init_data": urlencode(fields)})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "AUTH_REQUIRED"


async def test_admin_role_from_configuration(api: httpx.AsyncClient, login: Login) -> None:
    headers = await login(telegram_id=999)
    assert "audit:read_all" in (await api.get(f"{API}/me", headers=headers)).json()["permissions"]


@pytest.mark.parametrize("header", [None, "Bearer garbage", "Basic abc"])
async def test_authentication_required(api: httpx.AsyncClient, header: str | None) -> None:
    headers = {"Authorization": header} if header else {}
    response = await api.get(f"{API}/vehicles", headers=headers)
    assert response.status_code == 401
    assert response.json()["error"]["correlation_id"]


async def test_professional_mode_toggle(api: httpx.AsyncClient, login: Login) -> None:
    headers = await login()
    response = await api.patch(f"{API}/me", json={"professional_mode": True}, headers=headers)
    assert response.json()["professional_mode"] is True
    bad = await api.patch(f"{API}/me", json={"professional_mode": True, "role": "admin"}, headers=headers)
    assert bad.status_code == 422


async def test_gateway_status(api: httpx.AsyncClient, login: Login) -> None:
    headers = await login()
    status = (await api.get(f"{API}/gateway/status", headers=headers)).json()
    assert status["reachable"] is True
    assert status["simulation"] is True
    assert status["protocols"]["uds"].startswith("ISO 14229")


# ------------------------------------------------------------------ vehicles & scan


async def test_connect_creates_vehicle_from_vin_read_on_the_bus(api: httpx.AsyncClient, login: Login) -> None:
    headers = await login()
    body = await connect(api, headers)
    assert body["vehicle"]["vin"] == body["identity"]["vin"]
    assert body["vehicle"]["simulation"] is True
    assert body["vehicle"]["display_name"].endswith("Land Rover Range Rover")
    vehicles = (await api.get(f"{API}/vehicles", headers=headers)).json()
    assert [v["vin"] for v in vehicles] == [body["vehicle"]["vin"]]
    again = await connect(api, headers)
    assert again["vehicle"]["id"] == body["vehicle"]["id"]  # upsert, not duplicate


async def test_full_scan_endpoint(api: httpx.AsyncClient, login: Login) -> None:
    headers = await login()
    vehicle_id, scan = await connect_and_scan(api, headers)
    assert set(scan) >= {"vehicle", "ecus", "dtcs", "warnings", "duration_ms", "session_id"}
    assert len(scan["ecus"]) == 9
    assert len(scan["dtcs"]) == 6
    assert scan["trace"] is None  # professional mode off
    assert sorted(scan["comparison"]["appeared"])[0].startswith("0x716")

    detail = (await api.get(f"{API}/vehicles/{vehicle_id}", headers=headers)).json()
    assert detail["connected"] is True
    assert detail["ecu_count"] == 9
    assert detail["dtc_count"] == 6
    assert detail["active_dtc_count"] == 2
    assert detail["last_session"]["status"] == "completed"

    ecus = (await api.get(f"{API}/vehicles/{vehicle_id}/ecus", headers=headers)).json()
    assert ecus[0]["ecu"]["id"] == "0x716"
    assert ecus[0]["software_history"][0]["software_version"] == "S25.03.4"

    sessions = (await api.get(f"{API}/vehicles/{vehicle_id}/sessions", headers=headers)).json()
    session = (
        await api.get(f"{API}/vehicles/{vehicle_id}/sessions/{sessions[0]['id']}", headers=headers)
    ).json()
    assert session["trace"] is None
    assert session["vehicle_snapshot"]["vin"] == scan["vehicle"]["vin"]

    operations = (await api.get(f"{API}/operations", headers=headers)).json()
    assert [o["operation"] for o in operations][:2] == ["full_scan", "connect"]
    assert all(o["status"] == "completed" for o in operations)


async def test_professional_mode_includes_raw_trace(api: httpx.AsyncClient, login: Login) -> None:
    headers = await login()
    await api.patch(f"{API}/me", json={"professional_mode": True}, headers=headers)
    _, scan = await connect_and_scan(api, headers)
    assert scan["trace"][0]["direction"] == "TX"


async def test_dtc_queries_and_export(api: httpx.AsyncClient, login: Login) -> None:
    headers = await login()
    vehicle_id, _ = await connect_and_scan(api, headers)
    base = f"{API}/vehicles/{vehicle_id}/dtcs"
    assert (await api.get(base, headers=headers)).json()["total"] == 6
    active = (await api.get(f"{base}?state=active", headers=headers)).json()
    assert {d["display"] for d in active["dtcs"]} == {"P0171-00", "B1A55-11"}
    pcm = (await api.get(f"{base}?ecu_id=0x7E0", headers=headers)).json()
    assert pcm["total"] == 2
    grouped = (await api.get(f"{base}?group_by=system", headers=headers)).json()
    assert set(grouped["groups"]) == {"Powertrain", "Body", "Chassis", "Network"}
    search = (await api.get(f"{base}?search=catalyst", headers=headers)).json()
    assert [d["display"] for d in search["dtcs"]] == ["P0420-00"]
    assert (await api.get(f"{base}?system=X", headers=headers)).status_code == 422
    csv_response = await api.get(f"{base}/export.csv", headers=headers)
    assert csv_response.headers["content-type"].startswith("text/csv")
    assert csv_response.text.count("\n") == 7


async def test_clear_dtc_with_audit_and_history(api: httpx.AsyncClient, login: Login) -> None:
    headers = await login()
    vehicle_id, _ = await connect_and_scan(api, headers)
    unconfirmed = await api.post(
        f"{API}/vehicles/{vehicle_id}/dtcs/clear", json={"ecu_id": "0x7E0", "confirm": False}, headers=headers
    )
    assert unconfirmed.status_code == 428
    assert unconfirmed.json()["error"]["code"] == "CONFIRMATION_REQUIRED"

    cleared = await api.post(
        f"{API}/vehicles/{vehicle_id}/dtcs/clear", json={"ecu_id": "0x7E0", "confirm": True}, headers=headers
    )
    assert cleared.status_code == 200, cleared.text
    result = cleared.json()
    assert result["result"]["cleared"] is True
    assert result["result"]["safety"]["allowed"] is True

    audit = (await api.get(f"{API}/audit", headers=headers)).json()
    assert [a["result"] for a in audit] == ["SUCCESS", "BLOCKED"]
    success = audit[0]
    assert success["operation"] == "clear_dtc"
    assert success["ecu"] == "0x7E0"
    assert success["old_value"] == {"dtcs": ["P0171-00", "P0420-00"]}
    assert success["new_value"] == {"dtcs": ["P0171-00"]}
    assert success["software_version"] == "S24.07.2"
    assert success["vin"]

    rescan = await api.post(f"{API}/vehicles/{vehicle_id}/scan", headers=headers)
    assert "0x7E0 P0420-00" in rescan.json()["comparison"]["resolved"]
    events = (await api.get(f"{API}/vehicles/{vehicle_id}/dtc-events", headers=headers)).json()
    kinds = {e["event"] for e in events}
    assert {"APPEARED", "CLEARED", "RESOLVED", "STATUS_CHANGED"} <= kinds


async def test_viewer_cannot_operate(api: httpx.AsyncClient, login: Login, api_app: Any) -> None:
    tech = await login()
    vehicle_id, _ = await connect_and_scan(api, tech)
    from jlr_shared_types.permissions import Role

    api_app.state.context.settings.default_role = Role.VIEWER
    viewer = await login(telegram_id=555, username="viewer")
    assert (await api.post(f"{API}/vehicles/connect", headers=viewer)).status_code == 403
    # Viewer cannot see someone else's vehicle at all
    assert (await api.get(f"{API}/vehicles/{vehicle_id}", headers=viewer)).status_code == 404
    response = await api.post(
        f"{API}/vehicles/{vehicle_id}/dtcs/clear", json={"ecu_id": "0x7E0", "confirm": True}, headers=viewer
    )
    assert response.status_code == 403
    assert response.json()["error"]["details"]["permission"] == "dtc:clear"


async def test_live_data_endpoints(api: httpx.AsyncClient, login: Login) -> None:
    headers = await login()
    vehicle_id, _ = await connect_and_scan(api, headers)
    parameters = (await api.get(f"{API}/vehicles/{vehicle_id}/live-data/parameters", headers=headers)).json()
    ids = [p["id"] for p in parameters["parameters"] if p["ecu_id"] == "0x7E0"][:6]
    snapshot = await api.post(
        f"{API}/vehicles/{vehicle_id}/live-data", json={"parameter_ids": ids}, headers=headers
    )
    assert snapshot.status_code == 200
    assert {v["status"] for v in snapshot.json()["values"]} == {"OK"}
    too_many = await api.post(
        f"{API}/vehicles/{vehicle_id}/live-data", json={"parameter_ids": ["x"] * 65}, headers=headers
    )
    assert too_many.status_code == 422
    safety = (
        await api.post(
            f"{API}/vehicles/{vehicle_id}/safety",
            json={"operation": "clear_dtc", "risk": "LOW_RISK_WRITE"},
            headers=headers,
        )
    ).json()
    assert safety["decision"]["verdict"] == "ALLOWED"


async def test_gateway_on_other_vehicle_is_rejected(
    api: httpx.AsyncClient, login: Login, gateway_client: httpx.AsyncClient
) -> None:
    headers = await login()
    vehicle_id, _ = await connect_and_scan(api, headers)
    await gateway_client.post("/gw/v1/simulator/profile", json={"profile": "defender"})
    await gateway_client.post("/gw/v1/connect")
    response = await api.post(f"{API}/vehicles/{vehicle_id}/scan", headers=headers)
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "VIN_MISMATCH"
    clear = await api.post(
        f"{API}/vehicles/{vehicle_id}/dtcs/clear", json={"ecu_id": "0x7E0", "confirm": True}, headers=headers
    )
    assert clear.json()["error"]["code"] == "VIN_MISMATCH"
    audit = (await api.get(f"{API}/audit", headers=headers)).json()
    assert audit[0]["result"] == "BLOCKED"
    operations = (await api.get(f"{API}/operations", headers=headers)).json()
    assert operations[0]["status"] == "failed"
    assert operations[0]["error"]["code"] == "VIN_MISMATCH"


async def test_low_voltage_blocks_clear_through_api(
    api: httpx.AsyncClient, login: Login, gateway_client: httpx.AsyncClient
) -> None:
    headers = await login()
    vehicle_id, _ = await connect_and_scan(api, headers)
    await gateway_client.post("/gw/v1/simulator/faults", json={"battery_voltage": 10.8})
    response = await api.post(
        f"{API}/vehicles/{vehicle_id}/dtcs/clear", json={"ecu_id": "0x7E0", "confirm": True}, headers=headers
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "LOW_VOLTAGE"


async def test_gateway_unreachable_is_structured(api: httpx.AsyncClient, login: Login, api_app: Any) -> None:
    from jlr_api.gateway_client import GatewayClient

    headers = await login()

    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("refused", request=request)

    api_app.state.context.gateway = GatewayClient(
        "http://gateway", "token-token-token", transport=httpx.MockTransport(refuse)
    )
    response = await api.post(f"{API}/vehicles/connect", headers=headers)
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "GATEWAY_UNAVAILABLE"
    status = (await api.get(f"{API}/gateway/status", headers=headers)).json()
    assert status["reachable"] is False


async def test_rate_limit(api: httpx.AsyncClient, login: Login) -> None:
    headers = await login()
    codes = [(await api.post(f"{API}/vehicles/connect", headers=headers)).status_code for _ in range(7)]
    assert codes[:6] == [200] * 6
    assert codes[6] == 429


async def test_unknown_route_is_structured(api: httpx.AsyncClient) -> None:
    response = await api.get(f"{API}/does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "NOT_FOUND"


async def test_dev_auth_disabled_in_production_settings() -> None:
    from pydantic import ValidationError

    from jlr_api.settings import ApiSettings

    with pytest.raises(ValidationError, match="ALLOW_DEV_AUTH"):
        ApiSettings(
            environment="production",
            allow_dev_auth=True,
            jwt_secret="p" * 40,
            gateway_token="g" * 20,
            telegram_bot_token="t",
        )
    with pytest.raises(ValidationError, match="TELEGRAM_BOT_TOKEN"):
        ApiSettings(environment="production", jwt_secret="p" * 40, gateway_token="g" * 20)


@pytest.mark.postgres
@pytest.mark.skipif(
    not database_url().startswith("postgresql"), reason="requires TEST_DATABASE_URL (PostgreSQL)"
)
async def test_audit_log_is_append_only_in_postgres(
    api: httpx.AsyncClient, login: Login, api_app: Any
) -> None:
    from sqlalchemy import text
    from sqlalchemy.exc import DBAPIError

    headers = await login()
    vehicle_id, _ = await connect_and_scan(api, headers)
    await api.post(
        f"{API}/vehicles/{vehicle_id}/dtcs/clear", json={"ecu_id": "0x7E0", "confirm": True}, headers=headers
    )
    async with api_app.state.context.sessions() as db:
        with pytest.raises(DBAPIError, match="append-only"):
            await db.execute(text("DELETE FROM audit_logs"))
        await db.rollback()
        with pytest.raises(DBAPIError, match="append-only"):
            await db.execute(text("UPDATE audit_logs SET result = 'SUCCESS'"))
