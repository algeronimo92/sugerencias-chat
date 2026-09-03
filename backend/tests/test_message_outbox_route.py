import base64
from unittest.mock import AsyncMock
from types import SimpleNamespace

import pytest

from models.schemas import SendLocationRequest, SendMediaRequest, SendMessageRequest
from routers import chats
from services.media_storage import AudioTranscodeError

USER = SimpleNamespace(id=7)


@pytest.mark.asyncio
async def test_text_send_returns_queued_message_without_waiting_for_evolution(monkeypatch):
    queued = {
        "id": 77,
        "sender": "vendedor",
        "content": "Hola",
        "sent_at": "2026-07-21T12:00:00.000000Z",
        "media_url": None,
        "wa_message_id": None,
        "status": "PENDING",
    }
    require_lead = AsyncMock()
    enqueue = AsyncMock(return_value=queued)
    broadcast = AsyncMock()
    monkeypatch.setattr(chats, "_require_existing_lead", require_lead)
    monkeypatch.setattr(chats, "enqueue_text_message", enqueue)
    monkeypatch.setattr(chats.manager, "broadcast", broadcast)

    result = await chats.send_message(
        "51999999999@s.whatsapp.net",
        SendMessageRequest(text="  Hola  "),
        USER,
    )

    assert result == queued
    require_lead.assert_awaited_once_with("51999999999@s.whatsapp.net")
    enqueue.assert_awaited_once_with(
        "51999999999@s.whatsapp.net", "Hola", None, actor_user_id=USER.id,
    )
    broadcast.assert_awaited_once_with({
        "type": "chats_updated",
        "chat_id": "51999999999@s.whatsapp.net",
        "reason": "outbound_queued",
    })


@pytest.mark.asyncio
async def test_audio_send_stores_then_queues_without_waiting_for_evolution(monkeypatch):
    queued = {
        "id": 78, "sender": "vendedor", "content": "<audio></audio>",
        "sent_at": "2026-07-21T12:00:00.000000Z",
        "media_url": "/api/media/audio/voice.ogg", "wa_message_id": None,
        "status": "PENDING",
    }
    monkeypatch.setattr(chats, "_require_existing_lead", AsyncMock())
    monkeypatch.setattr(chats, "save_media_file", lambda *_args: queued["media_url"])
    enqueue = AsyncMock(return_value=[queued])
    monkeypatch.setattr(chats, "enqueue_messages", enqueue)
    broadcast = AsyncMock()
    monkeypatch.setattr(chats.manager, "broadcast", broadcast)

    result = await chats.send_audio(
        "51999999999@s.whatsapp.net",
        SendMediaRequest(content_type="audio/ogg", data_base64="QUJD"),
        USER,
    )

    assert result == queued
    enqueue.assert_awaited_once_with("51999999999@s.whatsapp.net", [{
        "content": None,
        "media_url": "/api/media/audio/voice.ogg",
        "payload": {"type": "audio", "media_url": "/api/media/audio/voice.ogg"},
        "reply_to": None,
    }], actor_user_id=USER.id)
    broadcast.assert_awaited_once()


@pytest.mark.asyncio
async def test_audio_send_transcodes_non_ogg_recordings_before_storing(monkeypatch):
    """Lo grabado en el navegador llega como webm/opus (o mp4/aac en Safari):
    Meta Cloud API acepta el envío igual, pero nunca lo reproduce como nota
    de voz del otro lado y el mensaje se queda sin doble check para siempre.
    Por eso se convierte a Ogg/Opus antes de guardar, salvo que ya venga en
    ese formato."""
    queued = {
        "id": 79, "sender": "vendedor", "content": "<audio></audio>",
        "sent_at": "2026-07-21T12:00:00.000000Z",
        "media_url": "/api/media/audio/voice.ogg", "wa_message_id": None,
        "status": "PENDING",
    }
    monkeypatch.setattr(chats, "_require_existing_lead", AsyncMock())
    save_calls = []
    monkeypatch.setattr(
        chats, "save_media_file",
        lambda content_type, data_base64: (save_calls.append((content_type, data_base64)), queued["media_url"])[1],
    )
    transcode = lambda data: b"ogg-bytes"
    monkeypatch.setattr(chats, "transcode_audio_to_ogg_opus", transcode)
    monkeypatch.setattr(chats, "enqueue_messages", AsyncMock(return_value=[queued]))
    monkeypatch.setattr(chats.manager, "broadcast", AsyncMock())

    await chats.send_audio(
        "51999999999@s.whatsapp.net",
        SendMediaRequest(content_type="audio/webm;codecs=opus", data_base64="QUJD"),
        USER,
    )

    assert len(save_calls) == 1
    content_type, data_base64 = save_calls[0]
    assert content_type == "audio/ogg"
    assert base64.b64decode(data_base64) == b"ogg-bytes"


@pytest.mark.asyncio
async def test_audio_send_falls_back_to_original_when_transcode_fails(monkeypatch):
    """Si ffmpeg no está disponible o falla, mejor mandar el audio original
    (aunque quizás no marque doble check) que no mandar nada."""
    queued = {
        "id": 80, "sender": "vendedor", "content": "<audio></audio>",
        "sent_at": "2026-07-21T12:00:00.000000Z",
        "media_url": "/api/media/audio/voice.webm", "wa_message_id": None,
        "status": "PENDING",
    }
    monkeypatch.setattr(chats, "_require_existing_lead", AsyncMock())
    save_calls = []
    monkeypatch.setattr(
        chats, "save_media_file",
        lambda content_type, data_base64: (save_calls.append((content_type, data_base64)), queued["media_url"])[1],
    )

    def _boom(_data):
        raise AudioTranscodeError("ffmpeg no está disponible")

    monkeypatch.setattr(chats, "transcode_audio_to_ogg_opus", _boom)
    monkeypatch.setattr(chats, "enqueue_messages", AsyncMock(return_value=[queued]))
    monkeypatch.setattr(chats.manager, "broadcast", AsyncMock())

    await chats.send_audio(
        "51999999999@s.whatsapp.net",
        SendMediaRequest(content_type="audio/webm;codecs=opus", data_base64="QUJD"),
        USER,
    )

    assert save_calls == [("audio/webm;codecs=opus", "QUJD")]


@pytest.mark.asyncio
async def test_location_send_returns_pending_job(monkeypatch):
    queued = {
        "id": 79, "sender": "vendedor",
        "content": "<location>-12.1,-77.0</location>",
        "sent_at": "2026-07-21T12:00:00.000000Z", "media_url": None,
        "wa_message_id": None, "status": "PENDING",
    }
    monkeypatch.setattr(chats, "_require_existing_lead", AsyncMock())
    enqueue = AsyncMock(return_value=[queued])
    monkeypatch.setattr(chats, "enqueue_messages", enqueue)
    monkeypatch.setattr(chats.manager, "broadcast", AsyncMock())

    result = await chats.send_location(
        "51999999999@s.whatsapp.net",
        SendLocationRequest(latitude=-12.1, longitude=-77.0),
        USER,
    )

    assert result["status"] == "PENDING"
    enqueue.assert_awaited_once()


@pytest.mark.asyncio
async def test_retry_reuses_failed_message_instead_of_creating_a_duplicate(monkeypatch):
    retried = {
        "id": 80, "sender": "vendedor", "content": "Hola",
        "sent_at": "2026-07-21T12:00:00.000000Z", "media_url": None,
        "wa_message_id": None, "status": "PENDING",
    }
    retry = AsyncMock(return_value=retried)
    monkeypatch.setattr(chats, "retry_failed_message", retry)
    monkeypatch.setattr(chats.manager, "broadcast", AsyncMock())

    result = await chats.retry_message("51999999999@s.whatsapp.net", 80)

    assert result["id"] == 80
    retry.assert_awaited_once_with("51999999999@s.whatsapp.net", 80)
