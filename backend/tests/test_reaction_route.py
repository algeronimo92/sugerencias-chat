from unittest.mock import AsyncMock

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.modules.conversations.schemas import ReactionRequest
from app.modules.conversations import api as chats
from app.modules.conversations import reactions
from app.integrations.whatsapp.channel import ChannelError
from tests.conftest import FakeSender, install_channel, patch_chats

CHAT_ID = "7b08f4d9-855f-4718-b95f-9c021da52f77"


def _patch_common(monkeypatch, *, target, sender=None, set_reaction=None):
    patch_chats(monkeypatch, "fetch_reply_target", AsyncMock(return_value=target))
    sender = sender or FakeSender()
    install_channel(monkeypatch, sender=sender)
    set_reaction = set_reaction or AsyncMock(return_value={"id": 7, "reactions": [{"emoji": "❤️", "from_me": True}]})
    monkeypatch.setattr(reactions, "set_message_reaction", set_reaction)
    record = AsyncMock(return_value=True)
    monkeypatch.setattr(reactions, "record_reaction_event", record)
    patch_chats(monkeypatch, "manager", SimpleNamespace(broadcast=AsyncMock()))
    return sender, set_reaction, record


@pytest.mark.asyncio
async def test_react_sends_the_meta_reaction_and_records_the_event(monkeypatch):
    sender, set_reaction, record = _patch_common(
        monkeypatch,
        target={"id": 9, "sender": "cliente", "content": "hola", "wa_message_id": "WA-9"},
    )

    result = await chats.react_to_message(CHAT_ID, 9, ReactionRequest(emoji="👍"))

    assert sender.only_call() == (
        CHAT_ID, {"type": "reaction", "reaction": {"message_id": "WA-9", "emoji": "👍"}},
    )
    set_reaction.assert_awaited_once_with(CHAT_ID, "WA-9", "👍", from_me=True)
    event = record.await_args.kwargs
    assert event["actor"] == "business"
    assert event["target_wa_message_id"] == "WA-9"
    assert event["provider_payload"]["reaction"] == {"message_id": "WA-9", "emoji": "👍"}
    assert result["id"] == 7


@pytest.mark.asyncio
async def test_empty_emoji_removes_reaction(monkeypatch):
    sender, set_reaction, _record = _patch_common(
        monkeypatch,
        target={"id": 7, "sender": "vendedor", "content": None, "wa_message_id": "WA-7"},
        set_reaction=AsyncMock(return_value={"id": 7, "reactions": None}),
    )

    await chats.react_to_message(CHAT_ID, 7, ReactionRequest(emoji=""))

    assert sender.only_call()[1]["reaction"] == {"message_id": "WA-7", "emoji": ""}
    set_reaction.assert_awaited_once_with(CHAT_ID, "WA-7", "", from_me=True)


@pytest.mark.asyncio
async def test_react_missing_message_returns_404(monkeypatch):
    _patch_common(monkeypatch, target=None)
    with pytest.raises(HTTPException) as exc:
        await chats.react_to_message(CHAT_ID, 1, ReactionRequest(emoji="❤️"))
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_react_unconfirmed_message_returns_409(monkeypatch):
    _patch_common(
        monkeypatch,
        target={"id": 5, "sender": "vendedor", "content": None, "wa_message_id": None},
    )
    with pytest.raises(HTTPException) as exc:
        await chats.react_to_message(CHAT_ID, 5, ReactionRequest(emoji="❤️"))
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_react_does_not_persist_when_channel_fails(monkeypatch):
    _sender, set_reaction, record = _patch_common(
        monkeypatch,
        target={"id": 7, "sender": "cliente", "content": "hola", "wa_message_id": "WA-7"},
        sender=FakeSender(fail_with=ChannelError("boom")),
    )
    with pytest.raises(HTTPException) as exc:
        await chats.react_to_message(CHAT_ID, 7, ReactionRequest(emoji="❤️"))
    assert exc.value.status_code == 502
    set_reaction.assert_not_awaited()
    record.assert_not_awaited()
