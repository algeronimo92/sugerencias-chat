from unittest.mock import AsyncMock

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from models.schemas import ReactionRequest
from routers import chats
from services.whatsapp_channel import ChannelError, ReactionTarget
from tests.conftest import FakeConversationActions, install_channel, patch_chats

CHAT_ID = "51999@s.whatsapp.net"


def _patch_common(monkeypatch, *, target, actions=None, set_reaction=None):
    patch_chats(monkeypatch, "fetch_reply_target", AsyncMock(return_value=target))
    actions = actions or FakeConversationActions()
    install_channel(monkeypatch, actions=actions)
    set_reaction = set_reaction or AsyncMock(return_value={"id": 7, "reactions": [{"emoji": "❤️", "from_me": True}]})
    patch_chats(monkeypatch, "set_message_reaction", set_reaction)
    patch_chats(monkeypatch, "manager", SimpleNamespace(broadcast=AsyncMock()))
    return actions, set_reaction


@pytest.mark.asyncio
async def test_react_targets_own_message(monkeypatch):
    actions, set_reaction = _patch_common(
        monkeypatch,
        target={"id": 7, "sender": "vendedor", "content": None, "wa_message_id": "WA-7"},
    )

    result = await chats.react_to_message(CHAT_ID, 7, ReactionRequest(emoji="❤️"))

    assert actions.reactions == [(ReactionTarget(CHAT_ID, "WA-7", from_me=True), "❤️")]
    set_reaction.assert_awaited_once_with(CHAT_ID, "WA-7", "❤️", from_me=True)
    assert result["id"] == 7


@pytest.mark.asyncio
async def test_react_targets_incoming_message(monkeypatch):
    actions, _ = _patch_common(
        monkeypatch,
        target={"id": 9, "sender": "cliente", "content": "hola", "wa_message_id": "WA-9"},
    )

    await chats.react_to_message(CHAT_ID, 9, ReactionRequest(emoji="👍"))

    assert actions.reactions == [(ReactionTarget(CHAT_ID, "WA-9", from_me=False), "👍")]


@pytest.mark.asyncio
async def test_empty_emoji_removes_reaction(monkeypatch):
    actions, set_reaction = _patch_common(
        monkeypatch,
        target={"id": 7, "sender": "vendedor", "content": None, "wa_message_id": "WA-7"},
        set_reaction=AsyncMock(return_value={"id": 7, "reactions": None}),
    )

    await chats.react_to_message(CHAT_ID, 7, ReactionRequest(emoji=""))

    assert actions.reactions == [(ReactionTarget(CHAT_ID, "WA-7", from_me=True), "")]
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
    set_reaction = AsyncMock()
    _patch_common(
        monkeypatch,
        target={"id": 7, "sender": "cliente", "content": "hola", "wa_message_id": "WA-7"},
        actions=FakeConversationActions(fail_with=ChannelError("boom")),
        set_reaction=set_reaction,
    )
    with pytest.raises(HTTPException) as exc:
        await chats.react_to_message(CHAT_ID, 7, ReactionRequest(emoji="❤️"))
    assert exc.value.status_code == 502
    set_reaction.assert_not_awaited()
