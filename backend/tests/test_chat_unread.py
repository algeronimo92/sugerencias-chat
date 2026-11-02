"""Marcar un chat como pendiente dentro del CRM."""

import pytest

from app.modules.conversations import api as chats
from app.modules.conversations.domain.errors import MessageNotFound
from app.modules.conversations.domain.events import ChatMarkedUnread


async def test_mark_chat_unread_announces_it(in_memory_conversations):
    in_memory_conversations.inbox.unread_candidates.add("lead-1")

    assert await chats.unread_chat("lead-1") == {"status": "ok"}

    assert in_memory_conversations.inbox.touches == [("unread", "lead-1")]
    [event] = in_memory_conversations.of(ChatMarkedUnread)
    assert event.chat_id == "lead-1"


async def test_mark_chat_unread_requires_customer_message(in_memory_conversations):
    with pytest.raises(MessageNotFound) as exc:
        await chats.unread_chat("lead-without-customer-messages")

    assert exc.value.status_code == 404
    assert exc.value.detail == "El chat no tiene mensajes del cliente para marcar"
    assert in_memory_conversations.published == []
