import json
from uuid import UUID

import httpx
import pytest
from unittest.mock import AsyncMock

from app.integrations.evolution import client as evolution
from app.integrations.whatsapp.channel import ChannelError


ORGANIZATION_ID = UUID("21675109-60f2-4c02-9be2-b359b2978f42")


def _configure(monkeypatch):
    monkeypatch.setattr(evolution, "platform_settings_many", AsyncMock(return_value={
        "evolution_api_url": "https://evolution.test/",
        "evolution_api_key": "secret-key",
        "evolution_webhook_url": "https://crm.test/api/webhooks/evolution/whatsapp",
        "evolution_webhook_token": "webhook-secret",
    }))
    monkeypatch.setattr(evolution.settings, "evolution_integration", "WHATSAPP-BAILEYS")


def _transport(monkeypatch, handler):
    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        evolution.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(transport=httpx.MockTransport(handler), **kwargs),
    )


def test_phone_is_normalized_and_instance_does_not_expose_it():
    assert evolution.normalize_phone("+51 987-654-321") == "51987654321"
    assert evolution.instance_name(ORGANIZATION_ID) == (
        "evolution-2167510960f24c029be2b359b2978f42"
    )
    assert "51987654321" not in evolution.instance_name(ORGANIZATION_ID)


@pytest.mark.parametrize("phone", ["", "123", "+00 12345678", "51-ABC-123"])
def test_invalid_phone_is_rejected(phone):
    with pytest.raises(ValueError, match="código de país"):
        evolution.normalize_phone(phone)


@pytest.mark.asyncio
async def test_connect_creates_one_tenant_instance_and_returns_pairing_data(monkeypatch):
    _configure(monkeypatch)
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.startswith("/instance/connectionState/"):
            return httpx.Response(404, json={"message": "not found"})
        if request.url.path == "/instance/create":
            return httpx.Response(201, json={"instance": {"instanceName": "created"}})
        return httpx.Response(
            200,
            json={"base64": "QR-CONTENT", "pairingCode": "ABCD1234"},
        )

    _transport(monkeypatch, handler)
    result = await evolution.connect(ORGANIZATION_ID, "+51 987 654 321")

    assert result.state == "connecting"
    assert result.qr_base64 == "QR-CONTENT"
    assert result.pairing_code == "ABCD1234"
    assert [request.method for request in requests] == ["GET", "GET", "POST", "GET"]
    assert all(request.headers["apikey"] == "secret-key" for request in requests)
    assert json.loads(requests[2].content)["number"] == "51987654321"
    assert json.loads(requests[2].content)["webhook"]["enabled"] is True
    assert requests[3].url.params["number"] == "51987654321"


@pytest.mark.asyncio
async def test_instance_from_the_previous_name_is_adopted_without_a_new_qr(monkeypatch):
    _configure(monkeypatch)
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        if request.url.path.endswith(evolution.legacy_instance_name(ORGANIZATION_ID)):
            return httpx.Response(200, json={"instance": {"state": "open"}})
        if request.url.path.startswith("/instance/connectionState/"):
            return httpx.Response(404, json={"message": "not found"})
        return httpx.Response(200, json={})

    _transport(monkeypatch, handler)
    result = await evolution.connect(ORGANIZATION_ID, "51987654321")

    assert result.state == "open"
    assert result.instance == evolution.legacy_instance_name(ORGANIZATION_ID)
    assert [request.method for request in requests] == ["GET", "GET", "POST"]
    assert requests[2].url.path.startswith("/webhook/set/")


@pytest.mark.asyncio
async def test_open_instance_is_not_recreated(monkeypatch):
    _configure(monkeypatch)
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(200, json={"instance": {"state": "open"}})

    _transport(monkeypatch, handler)
    result = await evolution.connect(ORGANIZATION_ID, "51987654321")

    assert result.state == "open"
    assert [request.url.path.split("/")[2] for request in requests] == ["connectionState", "set"]


@pytest.mark.asyncio
async def test_remove_is_idempotent_for_an_unlinked_instance(monkeypatch):
    _configure(monkeypatch)
    requests: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(404, json={"message": "not found"})

    _transport(monkeypatch, handler)
    result = await evolution.remove(ORGANIZATION_ID)

    assert result.state == "missing"
    assert [request.url.path.split("/")[2] for request in requests] == [
        "logout", "delete", "logout", "delete",
    ]


@pytest.mark.asyncio
async def test_status_does_not_call_network_when_evolution_is_unconfigured(monkeypatch):
    monkeypatch.setattr(evolution, "platform_settings_many", AsyncMock(return_value={
        key: "" for key in evolution.CONFIG_KEYS
    }))

    result = await evolution.connection_status(ORGANIZATION_ID)

    assert result.state == "not_configured"
    assert result.instance is None


@pytest.mark.asyncio
async def test_provider_rejection_keeps_the_status_for_the_outbox(monkeypatch):
    _configure(monkeypatch)
    _transport(monkeypatch, lambda request: httpx.Response(400, json={"message": "bad"}))

    with pytest.raises(evolution.EvolutionError) as rejected:
        await evolution.send_text("evolution-org", "51987654321", "Hola")

    assert isinstance(rejected.value, ChannelError)
    assert rejected.value.status_code == 400


@pytest.mark.asyncio
async def test_timeout_after_sending_is_not_retried_blindly(monkeypatch):
    _configure(monkeypatch)
    _transport(
        monkeypatch,
        lambda request: (_ for _ in ()).throw(httpx.ReadTimeout("timeout", request=request)),
    )

    with pytest.raises(evolution.EvolutionUnconfirmedError):
        await evolution.send_text("evolution-org", "51987654321", "Hola")


@pytest.mark.asyncio
async def test_connection_failure_is_left_retryable(monkeypatch):
    _configure(monkeypatch)
    _transport(
        monkeypatch,
        lambda request: (_ for _ in ()).throw(httpx.ConnectError("sin red", request=request)),
    )

    with pytest.raises(httpx.ConnectError):
        await evolution.send_text("evolution-org", "51987654321", "Hola")
