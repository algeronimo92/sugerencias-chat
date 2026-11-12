from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.integrations.evolution_webhook import api, processor
from app.integrations.evolution_webhook.processor import _identity, _project, _status


def test_webhook_requires_its_bearer_and_wakes_worker(monkeypatch):
    monkeypatch.setattr(api, "platform_setting", AsyncMock(return_value="hook-secret"))
    stored = AsyncMock(return_value=("event-1", False))
    notified = AsyncMock()
    monkeypatch.setattr(api, "store_event", stored)
    monkeypatch.setattr(api, "notify_new_events", notified)
    app = FastAPI()
    app.include_router(api.router)
    client = TestClient(app)
    payload = {"event": "messages.upsert", "instance": "evolution-org", "data": {}}

    assert client.post("/api/webhooks/evolution/whatsapp", json=payload).status_code == 401
    response = client.post(
        "/api/webhooks/evolution/whatsapp",
        json=payload,
        headers={"Authorization": "Bearer hook-secret"},
    )

    assert response.status_code == 200
    assert response.json() == {"received": True, "duplicate": False}
    stored.assert_awaited_once_with(payload)
    notified.assert_awaited_once()


def test_evolution_text_and_media_are_projected_to_the_shared_contract():
    text, kind, _, content, _ = _project({
        "messageType": "conversation",
        "message": {"conversation": "Hola"},
    })
    assert (kind, content, text) == ("text", "Hola", {"type": "text", "text": {"body": "Hola"}})

    image, kind, _, content, quoted = _project({
        "messageType": "imageMessage",
        "message": {"imageMessage": {
            "caption": "Antes",
            "mimetype": "image/jpeg",
            "contextInfo": {"stanzaId": "quoted-1"},
        }},
    })
    assert kind == "image"
    assert content == "Antes"
    assert quoted == "quoted-1"
    assert image["image"]["mime_type"] == "image/jpeg"


def test_identity_prefers_the_real_phone_over_the_lid():
    identity = _identity(
        "evolution-org",
        {
            "key": {
                "remoteJid": "123456789@lid",
                "remoteJidAlt": "51987654321@s.whatsapp.net",
            },
            "pushName": "Ana",
        },
    )

    assert identity.wa_id == "51987654321"
    assert identity.user_id == "123456789@lid"
    assert identity.profile_name == "Ana"


def test_business_echo_does_not_use_own_profile_as_recipient_name():
    identity = _identity(
        "evolution-org",
        {
            "key": {"remoteJid": "51987654321@s.whatsapp.net", "fromMe": True},
            "pushName": "Mi negocio",
        },
        from_business=True,
    )

    assert identity.wa_id == "51987654321"
    assert identity.profile_name is None


@pytest.mark.asyncio
async def test_delivery_update_uses_the_shared_status_contract(monkeypatch):
    recorded = AsyncMock()
    monkeypatch.setattr(processor, "record_provider_status", recorded)
    event = type("Event", (), {"id": "event-1"})()

    await _status({
        "keyId": "EVO-1",
        "messageId": "evolution-internal-id",
        "remoteJid": "51987654321@s.whatsapp.net",
        "status": "READ",
    }, event)

    recorded.assert_awaited_once()
    status = recorded.await_args.args[0]
    assert status["id"] == "EVO-1"
    assert status["status"] == "read"


@pytest.mark.asyncio
async def test_non_direct_chats_are_ignored(monkeypatch):
    recorded = AsyncMock()
    monkeypatch.setattr(processor, "record_provider_status", recorded)
    event = type("Event", (), {"id": "event-1"})()

    await _status({"keyId": "EVO-1", "remoteJid": "120363272939641376@g.us"}, event)
    recorded.assert_not_called()


@pytest.mark.asyncio
async def test_message_sent_from_linked_device_is_stored_as_business_echo(monkeypatch):
    resolved = type("Resolved", (), {"chat_id": "lead-1"})()
    monkeypatch.setattr(processor, "resolve_whatsapp_identity", AsyncMock(return_value=resolved))
    received = AsyncMock(return_value=({"id": 10, "chat_id": "lead-1"}, True))
    monkeypatch.setattr(processor, "receive_provider_message", received)
    event = type("Event", (), {"id": "event-1", "payload": {}})()

    await processor._message("evolution-org", {
        "key": {
            "id": "EVO-PHONE-1",
            "fromMe": True,
            "remoteJid": "51987654321@s.whatsapp.net",
        },
        "messageType": "conversation",
        "message": {"conversation": "Enviado desde el celular"},
    }, event)

    assert received.await_args.kwargs["sender"] == "vendedor"
    assert received.await_args.kwargs["human_outbound"] is True
    assert received.await_args.kwargs["channel_provider"] == "evolution"
    assert received.await_args.kwargs["content"] == "Enviado desde el celular"
