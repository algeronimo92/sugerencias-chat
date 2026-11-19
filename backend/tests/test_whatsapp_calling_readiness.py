"""Si el número del negocio puede activar las llamadas de WhatsApp
(docs/analisis/17-plan-llamadas-whatsapp.md, fase 1)."""

from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.integrations.meta import client as meta_service
from app.modules.platform import whatsapp_api
from app.modules.platform.calling_readiness import calling_readiness, messaging_limit_allows_calls


@pytest.mark.parametrize(("tier", "expected"), [
    ("TIER_250", False),
    ("TIER_1K", False),
    ("TIER_2K", True),
    ("TIER_10K", True),
    ("TIER_15K", True),
    ("TIER_100K", True),
    ("TIER_1M", True),
    ("TIER_UNLIMITED", True),
    # Niveles que no dicen un número: ni cumplido ni incumplido.
    ("TIER_NO_ACCESS", None),
    ("TIER_NUEVO_DE_META", None),
    ("", None),
    (None, None),
])
def test_the_messaging_limit_is_read_from_the_tier_name(tier, expected):
    assert messaging_limit_allows_calls(tier) is expected


@pytest.mark.parametrize(("requirements", "state"), [
    (None, "not_connected"),
    ({"on_business_app": False, "messaging_limit": "TIER_2K"}, "ready"),
    ({"on_business_app": False, "messaging_limit": "TIER_250"}, "limit_too_low"),
    ({"on_business_app": False, "messaging_limit": None}, "unverified"),
    ({"on_business_app": None, "messaging_limit": "TIER_2K"}, "unverified"),
    ({"on_business_app": True, "messaging_limit": "TIER_2K"}, "requires_migration"),
    # La coexistencia manda aunque falte o no alcance lo demás: es lo que la
    # persona tiene que saber primero.
    ({"on_business_app": True, "messaging_limit": "TIER_250"}, "requires_migration"),
    ({"on_business_app": True, "messaging_limit": None}, "requires_migration"),
])
def test_the_state_follows_what_meta_reported(requirements, state):
    assert calling_readiness(requirements)["state"] == state


def test_the_readiness_keeps_the_literal_limit_for_support():
    readiness = calling_readiness({"on_business_app": True, "messaging_limit": "TIER_250"})

    assert readiness == {
        "state": "requires_migration",
        "on_business_app": True,
        "messaging_limit": "TIER_250",
        "messaging_limit_ok": False,
    }


class _Response:
    def __init__(self, payload, *, is_error=False, status_code=200):
        self._payload = payload
        self.is_error = is_error
        self.status_code = status_code
        self.text = str(payload)

    def json(self):
        return self._payload


class _GraphClient:
    def __init__(self, responses):
        self._responses = list(responses)
        self.calls: list[dict] = []

    async def request(self, method, url, **kwargs):
        self.calls.append({"method": method, "url": url, **kwargs})
        return self._responses.pop(0)


def _connected(monkeypatch, responses) -> _GraphClient:
    graph = _GraphClient(responses)
    monkeypatch.setattr(meta_service, "_config", AsyncMock(return_value=("token-123", "PHONE1", "WABA1")))
    monkeypatch.setattr(meta_service, "_client", lambda: graph)
    return graph


async def test_the_requirements_come_from_the_crm_number(monkeypatch):
    graph = _connected(monkeypatch, [
        _Response({"is_on_biz_app": True, "platform_type": "CLOUD_API", "id": "PHONE1"}),
        _Response({"whatsapp_business_manager_messaging_limit": "TIER_2K", "id": "PHONE1"}),
    ])

    assert await meta_service.get_calling_requirements() == {"on_business_app": True, "messaging_limit": "TIER_2K"}
    assert [call["url"].rsplit("/", 1)[-1] for call in graph.calls] == ["PHONE1", "PHONE1"]
    assert graph.calls[0]["params"] == {"fields": "is_on_biz_app,platform_type"}
    assert graph.calls[1]["params"] == {"fields": "whatsapp_business_manager_messaging_limit"}


async def test_an_unreadable_limit_does_not_hide_the_coexistence(monkeypatch):
    """Graph rechaza el pedido entero por un campo que no reconoce: por eso
    el límite va en un pedido aparte."""
    _connected(monkeypatch, [
        _Response({"is_on_biz_app": True, "id": "PHONE1"}),
        _Response({"error": {"message": "(#100) Tried accessing nonexisting field", "code": 100}}, is_error=True, status_code=400),
    ])

    assert await meta_service.get_calling_requirements() == {"on_business_app": True, "messaging_limit": None}


async def test_what_meta_does_not_report_is_unknown_not_false(monkeypatch):
    _connected(monkeypatch, [_Response({"id": "PHONE1"}), _Response({"id": "PHONE1"})])

    assert await meta_service.get_calling_requirements() == {"on_business_app": None, "messaging_limit": None}


async def test_a_failure_reading_the_number_is_not_swallowed(monkeypatch):
    _connected(monkeypatch, [
        _Response({"error": {"message": "Unsupported get request", "code": 100}}, is_error=True, status_code=400),
    ])

    with pytest.raises(meta_service.MetaApiError):
        await meta_service.get_calling_requirements()


@pytest.fixture
def client(monkeypatch) -> TestClient:
    monkeypatch.setattr(whatsapp_api.meta_service, "is_configured", AsyncMock(return_value=True))
    app = FastAPI()
    app.include_router(whatsapp_api.router)
    return TestClient(app)


def test_a_number_still_on_the_business_app_requires_migration(client, monkeypatch):
    monkeypatch.setattr(
        whatsapp_api.meta_service, "get_calling_requirements",
        AsyncMock(return_value={"on_business_app": True, "messaging_limit": "TIER_2K"}),
    )

    response = client.get("/api/whatsapp/calling-readiness")

    assert response.status_code == 200
    assert response.json() == {
        "state": "requires_migration", "on_business_app": True,
        "messaging_limit": "TIER_2K", "messaging_limit_ok": True,
    }


def test_without_whatsapp_connected_meta_is_not_asked(client, monkeypatch):
    monkeypatch.setattr(whatsapp_api.meta_service, "is_configured", AsyncMock(return_value=False))
    ask = AsyncMock()
    monkeypatch.setattr(whatsapp_api.meta_service, "get_calling_requirements", ask)

    response = client.get("/api/whatsapp/calling-readiness")

    assert response.json()["state"] == "not_connected"
    ask.assert_not_awaited()


@pytest.mark.parametrize("failure", [
    meta_service.MetaApiError("Meta respondió 500", status_code=500),
    httpx.ConnectError("sin red"),
])
def test_when_meta_does_not_answer_the_state_is_not_invented(client, monkeypatch, failure):
    """Un 502 y no un estado apagado: la pantalla ofrece reintentar en vez de
    mostrar como definitivo algo que no se pudo consultar."""
    monkeypatch.setattr(whatsapp_api.meta_service, "get_calling_requirements", AsyncMock(side_effect=failure))

    response = client.get("/api/whatsapp/calling-readiness")

    assert response.status_code == 502
    assert "Meta no respondió" in response.json()["detail"]


# --- Activar las llamadas y su horario ------------------------------------

from app.modules.platform.calling_readiness import InvalidCallHours, calling_for_meta, calling_from_meta  # noqa: E402

WEEKDAY = {"day": "MONDAY", "open": "0900", "close": "1900"}


def test_enabling_sends_the_hours_and_the_product_decisions():
    assert calling_for_meta(enabled=True, hours=[WEEKDAY], timezone="America/Lima") == {
        "status": "ENABLED",
        # Decisiones de producto, no opciones: botón visible para todos y
        # devolver llamadas sin pedir permiso.
        "call_icon_visibility": "DEFAULT",
        "callback_permission_status": "ENABLED",
        "call_hours": {
            "status": "ENABLED", "timezone_id": "America/Lima",
            "weekly_operating_hours": [{"day_of_week": "MONDAY", "open_time": "0900", "close_time": "1900"}],
        },
    }
    assert calling_for_meta(enabled=False, hours=[], timezone="America/Lima") == {"status": "DISABLED"}


@pytest.mark.parametrize("hours", [
    [],
    [{"day": "MONDAY", "open": "1900", "close": "0900"}],
    [{"day": "MONDAY", "open": "2500", "close": "2600"}],
    [{"day": "LUNES", "open": "0900", "close": "1900"}],
    [WEEKDAY, {"day": "MONDAY", "open": "2000", "close": "2100"}, {"day": "MONDAY", "open": "2200", "close": "2300"}],
])
def test_calls_are_not_enabled_without_valid_hours(hours):
    with pytest.raises(InvalidCallHours):
        calling_for_meta(enabled=True, hours=hours, timezone="America/Lima")


def test_meta_settings_are_read_back_for_the_screen():
    assert calling_from_meta({
        "status": "ENABLED",
        "call_hours": {"status": "ENABLED", "weekly_operating_hours": [{"day_of_week": "MONDAY", "open_time": "0900", "close_time": "1900"}]},
    }) == {"enabled": True, "hours_enabled": True, "hours": [WEEKDAY]}
    assert calling_from_meta({}) == {"enabled": False, "hours_enabled": False, "hours": []}


@pytest.fixture
def calling(client, monkeypatch):
    monkeypatch.setattr(whatsapp_api.meta_service, "get_calling_settings", AsyncMock(return_value={"status": "ENABLED"}))
    monkeypatch.setattr(whatsapp_api.meta_service, "update_calling_settings", AsyncMock())
    monkeypatch.setattr(whatsapp_api, "list_call_agents", AsyncMock(return_value=[{"id": 2, "name": "Ana"}]))
    monkeypatch.setattr(whatsapp_api, "get_effective_many", AsyncMock(return_value={"business_timezone": "America/Lima"}))
    monkeypatch.setattr(whatsapp_api, "update_settings", AsyncMock())
    return client


def test_enabling_calls_configures_meta_and_the_permission_request(calling):
    response = calling.put("/api/whatsapp/calling", json={"enabled": True, "hours": [WEEKDAY]})

    assert response.status_code == 200
    assert response.json() == {"enabled": True, "hours_enabled": False, "hours": [], "agents": 1}
    sent = whatsapp_api.meta_service.update_calling_settings.await_args.args[0]
    assert sent["status"] == "ENABLED" and sent["call_hours"]["timezone_id"] == "America/Lima"
    whatsapp_api.update_settings.assert_awaited_once_with({"meta_call_permission_enabled": "true"})


def test_calls_are_not_enabled_while_nobody_answers(calling, monkeypatch):
    monkeypatch.setattr(whatsapp_api, "list_call_agents", AsyncMock(return_value=[]))

    response = calling.put("/api/whatsapp/calling", json={"enabled": True, "hours": [WEEKDAY]})

    assert response.status_code == 409
    whatsapp_api.meta_service.update_calling_settings.assert_not_awaited()


def test_enabling_without_hours_is_refused_before_asking_meta(calling):
    response = calling.put("/api/whatsapp/calling", json={"enabled": True, "hours": []})

    assert response.status_code == 422
    whatsapp_api.meta_service.update_calling_settings.assert_not_awaited()


def test_a_refusal_from_meta_does_not_flip_the_permission_request(calling):
    whatsapp_api.meta_service.update_calling_settings.side_effect = meta_service.MetaApiError("138015", status_code=400)

    response = calling.put("/api/whatsapp/calling", json={"enabled": True, "hours": [WEEKDAY]})

    assert response.status_code == 502
    whatsapp_api.update_settings.assert_not_awaited()


def test_disabling_needs_neither_hours_nor_agents(calling, monkeypatch):
    monkeypatch.setattr(whatsapp_api, "list_call_agents", AsyncMock(return_value=[]))

    response = calling.put("/api/whatsapp/calling", json={"enabled": False})

    assert response.status_code == 200
    assert whatsapp_api.meta_service.update_calling_settings.await_args.args[0] == {"status": "DISABLED"}
    whatsapp_api.update_settings.assert_awaited_once_with({"meta_call_permission_enabled": "false"})
