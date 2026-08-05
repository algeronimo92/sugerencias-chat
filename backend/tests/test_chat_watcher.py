from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from services import chat_watcher


def _cursor(second: int, message_id: int):
    return datetime(2026, 8, 5, 21, 52, second, tzinfo=timezone.utc), message_id


@pytest.mark.asyncio
async def test_processes_every_message_when_another_chat_changes_before_poll(monkeypatch):
    customer = {
        "message_id": "customer-14212",
        "chat_id": "lead-under-test",
        "sender": "cliente",
        "content": "Hola",
        "message_type": "text",
        "name": "Lead",
    }
    later_seller = {
        "message_id": "seller-14213",
        "chat_id": "another-lead",
        "sender": "vendedor",
        "content": "Respuesta",
        "message_type": "text",
        "name": "Otro lead",
    }
    fetch = AsyncMock(side_effect=[[
        (_cursor(25, 14212), customer),
        (_cursor(54, 14213), later_seller),
    ]])
    trigger = AsyncMock()
    broadcast = AsyncMock()
    monkeypatch.setattr(chat_watcher, "fetch_messages_after_cursor", fetch)
    monkeypatch.setattr(chat_watcher, "trigger_inbound_message", trigger)
    monkeypatch.setattr(chat_watcher.manager, "broadcast", broadcast)

    result = await chat_watcher.process_chat_changes(_cursor(2, 14211))

    assert result == _cursor(54, 14213)
    assert [call.args[0] for call in trigger.await_args_list] == [customer, later_seller]
    broadcast.assert_awaited_once_with({
        "type": "chats_updated",
        "reason": "external_message",
        "latest_message": later_seller,
        "chat_id": "another-lead",
    })


@pytest.mark.asyncio
async def test_empty_poll_keeps_cursor_and_does_not_broadcast(monkeypatch):
    initial = _cursor(2, 14211)
    monkeypatch.setattr(
        chat_watcher,
        "fetch_messages_after_cursor",
        AsyncMock(return_value=[]),
    )
    broadcast = AsyncMock()
    monkeypatch.setattr(chat_watcher.manager, "broadcast", broadcast)

    assert await chat_watcher.process_chat_changes(initial) == initial
    broadcast.assert_not_awaited()
