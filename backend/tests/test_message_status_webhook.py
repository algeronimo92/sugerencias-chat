from unittest.mock import AsyncMock

import pytest

from routers import webhooks


@pytest.mark.asyncio
async def test_incoming_read_receipt_advances_internal_unread_watermark(monkeypatch):
    monkeypatch.setattr(webhooks, "_check_token", AsyncMock())
    monkeypatch.setattr(webhooks, "update_message_status", AsyncMock(return_value=None))
    mark_read = AsyncMock(return_value={
        "chat_id": "51999999999@s.whatsapp.net",
        "last_read_at": "2026-07-20T13:43:21Z",
    })
    monkeypatch.setattr(webhooks, "mark_chat_read_from_whatsapp_receipt", mark_read)
    broadcast = AsyncMock()
    monkeypatch.setattr(webhooks.manager, "broadcast", broadcast)

    result = await webhooks.message_status_webhook({
        "wa_message_id": "WA-INCOMING",
        "status": "READ",
        "fromMe": False,
    })

    mark_read.assert_awaited_once_with("WA-INCOMING")
    broadcast.assert_awaited_once_with({
        "type": "chats_updated",
        "chat_id": "51999999999@s.whatsapp.net",
        "reason": "message_status",
    })
    assert result["matched"] is True
    assert result["read_count"] == 1


@pytest.mark.asyncio
async def test_outgoing_read_receipt_only_updates_delivery_status(monkeypatch):
    monkeypatch.setattr(webhooks, "_check_token", AsyncMock())
    monkeypatch.setattr(
        webhooks,
        "update_message_status",
        AsyncMock(return_value={"id": 1, "chat_id": "51999999999@s.whatsapp.net"}),
    )
    mark_read = AsyncMock()
    monkeypatch.setattr(webhooks, "mark_chat_read_from_whatsapp_receipt", mark_read)
    broadcast = AsyncMock()
    monkeypatch.setattr(webhooks.manager, "broadcast", broadcast)

    result = await webhooks.message_status_webhook({
        "wa_message_id": "WA-OUTGOING",
        "status": "READ",
        "from_me": True,
    })

    mark_read.assert_not_awaited()
    broadcast.assert_awaited_once_with({
        "type": "chats_updated",
        "chat_id": "51999999999@s.whatsapp.net",
        "reason": "message_status",
    })
    assert result["updated_count"] == 1
    assert result["read_count"] == 0


@pytest.mark.asyncio
async def test_delivery_receipt_does_not_mark_incoming_chat_read(monkeypatch):
    monkeypatch.setattr(webhooks, "_check_token", AsyncMock())
    monkeypatch.setattr(webhooks, "update_message_status", AsyncMock(return_value=None))
    mark_read = AsyncMock()
    monkeypatch.setattr(webhooks, "mark_chat_read_from_whatsapp_receipt", mark_read)
    broadcast = AsyncMock()
    monkeypatch.setattr(webhooks.manager, "broadcast", broadcast)

    result = await webhooks.message_status_webhook({
        "wa_message_id": "WA-INCOMING",
        "status": "DELIVERY_ACK",
        "from_me": False,
    })

    mark_read.assert_not_awaited()
    broadcast.assert_not_awaited()
    assert result["matched"] is False
    assert result["read_count"] == 0
