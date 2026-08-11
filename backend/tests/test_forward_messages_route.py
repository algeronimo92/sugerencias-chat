from unittest.mock import AsyncMock
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from models.schemas import ForwardMessagesRequest
from routers import chats

CHAT_ID = "51999999999@s.whatsapp.net"
TARGET = "51888888888@s.whatsapp.net"
OTHER_TARGET = "51777777777@s.whatsapp.net"
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
    monkeypatch.setattr(chats, "_require_existing_lead", AsyncMock())
    monkeypatch.setattr(chats, "fetch_messages_to_forward", AsyncMock(return_value=messages))
    monkeypatch.setattr(
        chats, "filter_existing_leads",
        AsyncMock(return_value={TARGET} if existing is None else existing),
    )
    enqueue = AsyncMock(return_value=[])
    monkeypatch.setattr(chats, "enqueue_messages", enqueue)
    monkeypatch.setattr(chats.manager, "broadcast", AsyncMock())
    return enqueue


class TestForwardItem:
    def test_text_travels_as_text(self):
        assert chats._forward_item(_message()) == {
            "content": "Hola",
            "payload": {"type": "text", "text": "Hola"},
            "forwarded": True,
        }

    def test_image_keeps_caption_and_file(self):
        item = chats._forward_item(_message(
            message_type="image", content="mirá esto", media_url="/api/media/img/a.jpg",
        ))
        assert item["media_url"] == "/api/media/img/a.jpg"
        assert item["payload"] == {
            "type": "media",
            "media_url": "/api/media/img/a.jpg",
            "mediatype": "image",
            "filename": None,
            "caption": "mirá esto",
        }

    def test_document_keeps_its_filename(self):
        item = chats._forward_item(_message(
            message_type="document", content=None,
            media_url="/api/media/doc/presupuesto.pdf",
            payload={"filename": "presupuesto.pdf"},
        ))
        assert item["payload"]["filename"] == "presupuesto.pdf"
        assert item["payload"]["mediatype"] == "document"

    def test_video_note_is_forwarded_as_a_plain_video(self):
        item = chats._forward_item(_message(
            message_type="ptv", content=None, media_url="/api/media/video/v.mp4",
        ))
        assert item["payload"]["mediatype"] == "video"

    def test_audio_uses_the_voice_note_endpoint(self):
        item = chats._forward_item(_message(
            message_type="audio", content=None, media_url="/api/media/audio/a.ogg",
        ))
        assert item["payload"] == {"type": "audio", "media_url": "/api/media/audio/a.ogg"}

    def test_location_carries_the_coordinates(self):
        item = chats._forward_item(_message(
            message_type="location", content=None,
            payload={"latitude": -12.1, "longitude": -77.0},
        ))
        assert item["payload"] == {"type": "location", "latitude": -12.1, "longitude": -77.0}

    def test_interactive_message_falls_back_to_its_text(self):
        # Del otro lado no se puede reconstruir el menú, pero el texto sí llega.
        item = chats._forward_item(_message(
            message_type="interactive", content="Elegí una opción",
        ))
        assert item["payload"] == {"type": "text", "text": "Elegí una opción"}

    def test_message_without_text_nor_file_is_not_forwardable(self):
        assert chats._forward_item(_message(message_type="poll", content=None)) is None


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
