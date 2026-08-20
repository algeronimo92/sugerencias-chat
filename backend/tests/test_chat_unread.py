import pytest
from fastapi import HTTPException

from routers import chats


@pytest.mark.asyncio
async def test_mark_chat_unread_broadcasts_update(monkeypatch):
    events = []

    async def fake_mark(chat_id):
        return chat_id == "lead-1"

    async def fake_broadcast(payload):
        events.append(payload)

    monkeypatch.setattr(chats, "mark_chat_unread", fake_mark)
    monkeypatch.setattr(chats.manager, "broadcast", fake_broadcast)

    assert await chats.unread_chat("lead-1") == {"status": "ok"}
    assert events == [{"type": "chats_updated", "chat_id": "lead-1", "reason": "unread"}]


@pytest.mark.asyncio
async def test_mark_chat_unread_requires_customer_message(monkeypatch):
    async def fake_mark(_chat_id):
        return False

    monkeypatch.setattr(chats, "mark_chat_unread", fake_mark)

    with pytest.raises(HTTPException) as exc:
        await chats.unread_chat("lead-without-customer-messages")
    assert exc.value.status_code == 404
