"""Reaccionar desde el CRM: primero WhatsApp, después lo nuestro."""

from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.integrations.whatsapp.channel import ChannelError
from app.modules.conversations import api as chats
from app.modules.conversations.domain.errors import MessageNotConfirmed, MessageNotFound
from app.modules.conversations.domain.events import ReactionChanged
from app.modules.conversations.schemas import ReactionRequest
from tests.conftest import patch_chats

CHAT_ID = "4316bc30-f78c-57a2-8f98-bff9087678d6"


@pytest.fixture
def target(in_memory_conversations, monkeypatch):
    def install(value):
        patch_chats(monkeypatch, "fetch_reply_target", AsyncMock(return_value=value))
        if value and value["wa_message_id"]:
            in_memory_conversations.messages.reactions[(CHAT_ID, value["wa_message_id"])] = {"id": value["id"]}
        return in_memory_conversations
    return install


async def test_react_sends_the_meta_reaction_and_records_the_event(target):
    world = target({"id": 9, "sender": "cliente", "content": "hola", "wa_message_id": "WA-9"})

    result = await chats.react_to_message(CHAT_ID, 9, ReactionRequest(emoji="👍"))

    assert world.sender.calls == [
        (CHAT_ID, {"type": "reaction", "reaction": {"message_id": "WA-9", "emoji": "👍"}}),
    ]
    [event] = world.messages.reaction_events
    assert event["actor"] == "business"
    assert event["target_wa_message_id"] == "WA-9"
    assert event["provider_payload"]["reaction"] == {"message_id": "WA-9", "emoji": "👍"}
    assert result == {"id": 9, "reactions": [{"emoji": "👍", "from_me": True}]}
    assert world.of(ReactionChanged)


async def test_empty_emoji_removes_reaction(target):
    world = target({"id": 7, "sender": "vendedor", "content": None, "wa_message_id": "WA-7"})

    result = await chats.react_to_message(CHAT_ID, 7, ReactionRequest(emoji=""))

    assert world.sender.calls[0][1]["reaction"] == {"message_id": "WA-7", "emoji": ""}
    assert result["reactions"] is None


async def test_react_missing_message_returns_404(target):
    target(None)
    with pytest.raises(MessageNotFound) as exc:
        await chats.react_to_message(CHAT_ID, 1, ReactionRequest(emoji="❤️"))
    assert exc.value.status_code == 404


async def test_react_unconfirmed_message_returns_409(target):
    target({"id": 5, "sender": "vendedor", "content": None, "wa_message_id": None})
    with pytest.raises(MessageNotConfirmed) as exc:
        await chats.react_to_message(CHAT_ID, 5, ReactionRequest(emoji="❤️"))
    assert exc.value.status_code == 409


async def test_react_does_not_persist_when_channel_fails(target):
    world = target({"id": 7, "sender": "cliente", "content": "hola", "wa_message_id": "WA-7"})
    world.sender.fail_with = ChannelError("boom")

    with pytest.raises(HTTPException) as exc:
        await chats.react_to_message(CHAT_ID, 7, ReactionRequest(emoji="❤️"))

    assert exc.value.status_code == 502
    assert world.messages.reaction_events == []
    assert world.published == []
