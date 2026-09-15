from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from models.schemas import SendTemplateRequest, StickerRequest
from routers import chats, webhooks

SELLER = SimpleNamespace(id=7, role="vendedor")
CHAT_ID = "51999@s.whatsapp.net"


@pytest.fixture
def broadcast(monkeypatch):
    mock = AsyncMock()
    monkeypatch.setattr(chats.manager, "broadcast", mock)
    monkeypatch.setattr(webhooks.manager, "broadcast", mock)
    return mock


async def test_sticker_is_queued_in_the_outbox_instead_of_sent_directly(monkeypatch, broadcast):
    monkeypatch.setattr(chats, "lead_exists", AsyncMock(return_value=True))
    monkeypatch.setattr(chats, "get_media_asset", AsyncMock(return_value={
        "id": 3, "media_url": "/api/media/images/gato.png", "content_type": "image/png",
    }))
    enqueue = AsyncMock(return_value=[{"id": 1, "status": "PENDING"}])
    monkeypatch.setattr(chats, "enqueue_messages", enqueue)

    result = await chats.send_sticker(CHAT_ID, StickerRequest(asset_id=3), SELLER)

    assert result == {"id": 1, "status": "PENDING"}
    enqueue.assert_awaited_once_with(CHAT_ID, [{
        "media_url": "/api/media/images/gato.png",
        "payload": {"type": "sticker", "media_url": "/api/media/images/gato.png"},
    }], actor_user_id=SELLER.id)


async def test_sticker_rejects_assets_that_are_not_images(monkeypatch, broadcast):
    monkeypatch.setattr(chats, "lead_exists", AsyncMock(return_value=True))
    monkeypatch.setattr(chats, "get_media_asset", AsyncMock(return_value={
        "id": 3, "media_url": "/api/media/documents/a.pdf", "content_type": "application/pdf",
    }))
    enqueue = AsyncMock()
    monkeypatch.setattr(chats, "enqueue_messages", enqueue)

    with pytest.raises(HTTPException) as exc:
        await chats.send_sticker(CHAT_ID, StickerRequest(asset_id=3), SELLER)

    assert exc.value.status_code == 400
    enqueue.assert_not_awaited()


async def test_official_template_to_unknown_lead_is_404_before_queueing(monkeypatch, broadcast):
    monkeypatch.setattr(chats, "list_templates", AsyncMock(return_value=[{
        "id": 4, "template_type": "official", "official_status": "APPROVED",
        "official_parameter_values": [], "content": "Hola", "official_name": "hola",
        "official_language": "es",
    }]))
    monkeypatch.setattr(chats, "lead_exists", AsyncMock(return_value=False))
    enqueue = AsyncMock()
    monkeypatch.setattr(chats, "enqueue_messages", enqueue)

    with pytest.raises(HTTPException) as exc:
        await chats.send_template(CHAT_ID, 4, SendTemplateRequest(), SELLER)

    assert exc.value.status_code == 404
    enqueue.assert_not_awaited()


@pytest.mark.parametrize("body", [{}, {"wa_message_id": ""}, {"wa_message_id": "   "}])
def test_inbound_message_webhook_requires_the_message_id(body):
    with pytest.raises(ValidationError):
        webhooks.NewMessageWebhookBody(**body)


async def test_unknown_inbound_id_never_falls_back_to_another_chats_message(monkeypatch, broadcast):
    monkeypatch.setattr(webhooks, "fetch_message_by_wa_id", AsyncMock(return_value=None))
    monkeypatch.setattr(webhooks, "rehost_ad_thumbnail", AsyncMock())
    trigger = AsyncMock()
    monkeypatch.setattr(webhooks, "trigger_inbound_message", trigger)

    await webhooks.new_message_webhook(webhooks.NewMessageWebhookBody(wa_message_id="WA-X"))

    trigger.assert_not_awaited()
    broadcast.assert_awaited_once_with({"type": "chats_updated", "reason": "inbound_message"})
