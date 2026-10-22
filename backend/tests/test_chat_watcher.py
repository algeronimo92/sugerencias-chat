"""El vigilante de chats: mensajes que otro sistema insertó en la base."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from app.modules.conversations import chat_watcher
from app.modules.conversations.domain.events import ExternalMessageDetected, ExternalMessagesSynced


def _cursor(second: int, message_id: int):
    return datetime(2026, 8, 5, 21, 52, second, tzinfo=timezone.utc), message_id


@pytest.fixture
def published(monkeypatch):
    events: list[tuple[object, bool]] = []

    async def publish(*items, strict=False):
        events.extend((item, strict) for item in items)

    monkeypatch.setattr(chat_watcher, "publish", publish)
    return events


async def test_processes_every_message_when_another_chat_changes_before_poll(monkeypatch, published):
    customer = {"message_id": "customer-14212", "chat_id": "lead-under-test", "sender": "cliente",
                "content": "Hola", "message_type": "text", "name": "Lead"}
    later_seller = {"message_id": "seller-14213", "chat_id": "another-lead", "sender": "vendedor",
                    "content": "Respuesta", "message_type": "text", "name": "Otro lead"}
    monkeypatch.setattr(chat_watcher, "fetch_messages_after_cursor", AsyncMock(side_effect=[[
        (_cursor(25, 14212), customer),
        (_cursor(54, 14213), later_seller),
    ]]))

    result = await chat_watcher.process_chat_changes(_cursor(2, 14211))

    assert result == _cursor(54, 14213)
    detected = [(event.message, strict) for event, strict in published if isinstance(event, ExternalMessageDetected)]
    # Estricto: si agendar una automatización falla, el cursor no avanza.
    assert detected == [(customer, True), (later_seller, True)]
    [synced] = [event for event, _ in published if isinstance(event, ExternalMessagesSynced)]
    assert (synced.chat_id, synced.latest) == ("another-lead", later_seller)


async def test_a_failure_stops_the_pass_without_moving_the_cursor(monkeypatch):
    message = {"message_id": "m-1", "chat_id": "lead", "sender": "cliente"}
    monkeypatch.setattr(chat_watcher, "fetch_messages_after_cursor", AsyncMock(return_value=[(_cursor(5, 1), message)]))
    monkeypatch.setattr(chat_watcher, "publish", AsyncMock(side_effect=RuntimeError("db")))

    with pytest.raises(RuntimeError):
        await chat_watcher.process_chat_changes(_cursor(2, 0))


async def test_empty_poll_keeps_cursor_and_announces_nothing(monkeypatch, published):
    initial = _cursor(2, 14211)
    monkeypatch.setattr(chat_watcher, "fetch_messages_after_cursor", AsyncMock(return_value=[]))

    assert await chat_watcher.process_chat_changes(initial) == initial
    assert published == []
