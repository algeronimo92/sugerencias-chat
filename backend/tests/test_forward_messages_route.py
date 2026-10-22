from unittest.mock import AsyncMock
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.modules.conversations.schemas import ForwardMessagesRequest
from app.modules.conversations import api as chats
from tests.conftest import patch_chats

CHAT_ID = "1fbbc88a-3cd3-5ae2-9b58-9772fc53bab6"
TARGET = "ae6ec286-8f50-52f1-94c0-89e92f3c0e1e"
OTHER_TARGET = "26b3350d-169d-5d67-89f6-ab65487e91bf"
USER = SimpleNamespace(id=7)


def _message(**overrides) -> dict:
    return {
        "id": 1,
        "sender": "cliente",
        "content": "Hola",
        "media_url": None,
        "message_type": "text",
        "payload": None,
        **overrides,
    }


def _patch(monkeypatch, *, messages, existing=None):
    patch_chats(monkeypatch, "_require_existing_lead", AsyncMock())
    patch_chats(monkeypatch, "fetch_messages_to_forward", AsyncMock(return_value=messages))
    patch_chats(
        monkeypatch, "filter_existing_leads",
        AsyncMock(return_value={TARGET} if existing is None else existing),
    )
    enqueue = AsyncMock(return_value=[])
    patch_chats(monkeypatch, "queue_messages", enqueue)
    return enqueue


class TestForwardRoute:
    @pytest.mark.asyncio
    async def test_queues_every_message_in_every_target(self, monkeypatch):
        enqueue = _patch(
            monkeypatch,
            messages=[_message(id=1, content="uno"), _message(id=2, content="dos")],
            existing={TARGET, OTHER_TARGET},
        )

        result = await chats.forward_messages(CHAT_ID, ForwardMessagesRequest(
            message_ids=[2, 1], target_chat_ids=[TARGET, OTHER_TARGET],
        ), USER)

        assert result.forwarded_chats == 2
        assert result.forwarded_messages == 4
        assert result.skipped_messages == 0
        assert [call.args[0] for call in enqueue.await_args_list] == [TARGET, OTHER_TARGET]
        assert all(call.kwargs == {"actor_user_id": USER.id} for call in enqueue.await_args_list)
        # El orden es el de la conversación (el que devuelve la base), no el
        # orden en que se fueron tildando los mensajes.
        assert [item["content"] for item in enqueue.await_args_list[0].args[1]] == ["uno", "dos"]

    @pytest.mark.asyncio
    async def test_repeated_target_is_sent_once(self, monkeypatch):
        enqueue = _patch(monkeypatch, messages=[_message()])

        result = await chats.forward_messages(CHAT_ID, ForwardMessagesRequest(
            message_ids=[1], target_chat_ids=[TARGET, TARGET],
        ), USER)

        assert result.forwarded_chats == 1
        enqueue.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_unforwardable_messages_are_counted_but_do_not_block(self, monkeypatch):
        enqueue = _patch(
            monkeypatch,
            messages=[_message(id=1), _message(id=2, message_type="poll", content=None)],
        )

        result = await chats.forward_messages(CHAT_ID, ForwardMessagesRequest(
            message_ids=[1, 2], target_chat_ids=[TARGET],
        ), USER)

        assert result.skipped_messages == 1
        assert result.forwarded_messages == 1
        assert len(enqueue.await_args_list[0].args[1]) == 1

    @pytest.mark.asyncio
    async def test_missing_messages_return_404(self, monkeypatch):
        _patch(monkeypatch, messages=[])
        with pytest.raises(HTTPException) as exc:
            await chats.forward_messages(CHAT_ID, ForwardMessagesRequest(
                message_ids=[1], target_chat_ids=[TARGET],
            ), USER)
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_nothing_forwardable_returns_409(self, monkeypatch):
        enqueue = _patch(monkeypatch, messages=[_message(message_type="poll", content=None)])
        with pytest.raises(HTTPException) as exc:
            await chats.forward_messages(CHAT_ID, ForwardMessagesRequest(
                message_ids=[1], target_chat_ids=[TARGET],
            ), USER)
        assert exc.value.status_code == 409
        enqueue.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_deleted_target_lead_returns_404(self, monkeypatch):
        enqueue = _patch(monkeypatch, messages=[_message()], existing=set())
        with pytest.raises(HTTPException) as exc:
            await chats.forward_messages(CHAT_ID, ForwardMessagesRequest(
                message_ids=[1], target_chat_ids=[TARGET],
            ), USER)
        assert exc.value.status_code == 404
        enqueue.assert_not_awaited()
