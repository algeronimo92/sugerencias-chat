from unittest.mock import AsyncMock

import pytest

from models.schemas import SendMessageRequest
from routers import chats


@pytest.mark.asyncio
async def test_text_send_returns_queued_message_without_waiting_for_evolution(monkeypatch):
    queued = {
        "id": 77,
        "sender": "vendedor",
        "content": "Hola",
        "sent_at": "2026-07-21T12:00:00.000000Z",
        "media_url": None,
        "wa_message_id": None,
        "status": "PENDING",
    }
    require_lead = AsyncMock()
    enqueue = AsyncMock(return_value=queued)
    evolution = AsyncMock()
    broadcast = AsyncMock()
    monkeypatch.setattr(chats, "_require_existing_lead", require_lead)
    monkeypatch.setattr(chats, "enqueue_text_message", enqueue)
    monkeypatch.setattr(chats, "send_whatsapp_text", evolution)
    monkeypatch.setattr(chats.manager, "broadcast", broadcast)

    result = await chats.send_message(
        "51999999999@s.whatsapp.net",
        SendMessageRequest(text="  Hola  "),
    )

    assert result == queued
    require_lead.assert_awaited_once_with("51999999999@s.whatsapp.net")
    enqueue.assert_awaited_once_with("51999999999@s.whatsapp.net", "Hola")
    evolution.assert_not_awaited()
    broadcast.assert_awaited_once_with({
        "type": "chats_updated",
        "chat_id": "51999999999@s.whatsapp.net",
        "reason": "outbound_queued",
    })
