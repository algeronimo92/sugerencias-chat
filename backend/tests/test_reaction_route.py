from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException

from routers import chats
from models.schemas import ReactionRequest
from services.evolution_service import EvolutionApiError


def _patch_common(monkeypatch, *, target, send=None, set_reaction=None):
    monkeypatch.setattr(chats, "fetch_reply_target", AsyncMock(return_value=target))
    send = send or AsyncMock(return_value={})
    monkeypatch.setattr(chats, "send_whatsapp_reaction", send)
    set_reaction = set_reaction or AsyncMock(return_value={"id": 7, "reactions": [{"emoji": "❤️", "from_me": True}]})
    monkeypatch.setattr(chats, "set_message_reaction", set_reaction)
    monkeypatch.setattr(chats.manager, "broadcast", AsyncMock())
    return send, set_reaction


@pytest.mark.asyncio
async def test_react_builds_from_me_key_for_own_message(monkeypatch):
    send, set_reaction = _patch_common(
        monkeypatch,
        target={"id": 7, "sender": "vendedor", "content": None, "wa_message_id": "WA-7"},
    )

    result = await chats.react_to_message("51999@s.whatsapp.net", 7, ReactionRequest(emoji="❤️"))

    send.assert_awaited_once_with(
        {"remoteJid": "51999@s.whatsapp.net", "fromMe": True, "id": "WA-7"}, "❤️"
    )
    set_reaction.assert_awaited_once_with("51999@s.whatsapp.net", "WA-7", "❤️", from_me=True)
    assert result["id"] == 7


@pytest.mark.asyncio
async def test_react_builds_client_key_for_incoming_message(monkeypatch):
    send, _ = _patch_common(
        monkeypatch,
        target={"id": 9, "sender": "cliente", "content": "hola", "wa_message_id": "WA-9"},
    )

    await chats.react_to_message("51999@s.whatsapp.net", 9, ReactionRequest(emoji="👍"))

    send.assert_awaited_once_with(
        {"remoteJid": "51999@s.whatsapp.net", "fromMe": False, "id": "WA-9"}, "👍"
    )


@pytest.mark.asyncio
async def test_empty_emoji_removes_reaction(monkeypatch):
    send, set_reaction = _patch_common(
        monkeypatch,
        target={"id": 7, "sender": "vendedor", "content": None, "wa_message_id": "WA-7"},
        set_reaction=AsyncMock(return_value={"id": 7, "reactions": None}),
    )

    await chats.react_to_message("51999@s.whatsapp.net", 7, ReactionRequest(emoji=""))

    send.assert_awaited_once_with(
        {"remoteJid": "51999@s.whatsapp.net", "fromMe": True, "id": "WA-7"}, ""
    )
    set_reaction.assert_awaited_once_with("51999@s.whatsapp.net", "WA-7", "", from_me=True)


@pytest.mark.asyncio
async def test_react_missing_message_returns_404(monkeypatch):
    _patch_common(monkeypatch, target=None)
    with pytest.raises(HTTPException) as exc:
        await chats.react_to_message("51999@s.whatsapp.net", 1, ReactionRequest(emoji="❤️"))
    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_react_unconfirmed_message_returns_409(monkeypatch):
    # Mensaje del vendedor todavía en la outbox: sin wa_message_id no se puede
    # reaccionar.
    _patch_common(
        monkeypatch,
        target={"id": 5, "sender": "vendedor", "content": None, "wa_message_id": None},
    )
    with pytest.raises(HTTPException) as exc:
        await chats.react_to_message("51999@s.whatsapp.net", 5, ReactionRequest(emoji="❤️"))
    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_react_does_not_persist_when_evolution_fails(monkeypatch):
    set_reaction = AsyncMock()
    _patch_common(
        monkeypatch,
        target={"id": 7, "sender": "cliente", "content": "hola", "wa_message_id": "WA-7"},
        send=AsyncMock(side_effect=EvolutionApiError("boom")),
        set_reaction=set_reaction,
    )
    with pytest.raises(HTTPException) as exc:
        await chats.react_to_message("51999@s.whatsapp.net", 7, ReactionRequest(emoji="❤️"))
    assert exc.value.status_code == 502
    # No se guarda el badge si no llegó a WhatsApp.
    set_reaction.assert_not_awaited()
