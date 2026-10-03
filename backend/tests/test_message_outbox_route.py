import base64
from unittest.mock import AsyncMock
from types import SimpleNamespace

import pytest

from app.modules.conversations.schemas import SendLocationRequest, SendMediaRequest, SendMessageRequest
from app.modules.conversations import api as chats
from app.integrations.storage.media_storage import AudioTranscodeError
from tests.conftest import open_service_window, patch_chats

USER = SimpleNamespace(id=7)
CHAT_ID = "7b08f4d9-855f-4718-b95f-9c021da52f77"


@pytest.mark.asyncio
async def test_text_send_returns_queued_message_without_waiting_for_meta(monkeypatch):
    queued = {
        "id": 77,
        "sender": "vendedor",
        "content": "Hola",
        "sent_at": "2026-07-21T12:00:00.000000Z",
        "media_url": None,
        "wa_message_id": None,
        "outbox_status": "queued",
    }
    require_lead = AsyncMock()
    enqueue = AsyncMock(return_value=[queued])
    patch_chats(monkeypatch, "_require_existing_lead", require_lead)
    open_service_window(monkeypatch)
    patch_chats(monkeypatch, "queue_messages", enqueue)

    result = await chats.send_message(
        CHAT_ID,
        SendMessageRequest(text="  Hola  "),
        USER,
    )

    assert result == queued
    require_lead.assert_awaited_once_with(CHAT_ID)
    enqueue.assert_awaited_once_with(
        CHAT_ID,
        [{"content": "Hola", "message": {"type": "text", "text": {"body": "Hola"}}, "reply_to": None}],
        actor_user_id=USER.id,
    )


@pytest.mark.asyncio
async def test_audio_send_stores_then_queues_without_waiting_for_meta(monkeypatch):
    queued = {
        "id": 78, "sender": "vendedor", "content": None,
        "sent_at": "2026-07-21T12:00:00.000000Z",
        "media_url": "/api/media/audio/voice.ogg", "wa_message_id": None,
        "outbox_status": "queued",
    }
    patch_chats(monkeypatch, "_require_existing_lead", AsyncMock())
    open_service_window(monkeypatch)
    patch_chats(monkeypatch, "save_decoded_media", lambda *_args: queued["media_url"])
    enqueue = AsyncMock(return_value=[queued])
    patch_chats(monkeypatch, "queue_messages", enqueue)

    result = await chats.send_audio(
        CHAT_ID,
        SendMediaRequest(content_type="audio/ogg", data_base64="QUJD"),
        USER,
    )

    assert result == queued
    [item] = enqueue.await_args.args[1]
    assert item["message"] == {"type": "audio", "audio": {"voice": True}}
    assert item["media"]["media_url"] == "/api/media/audio/voice.ogg"
    assert item["media_url"] == "/api/media/audio/voice.ogg"


@pytest.mark.asyncio
async def test_audio_send_transcodes_non_ogg_recordings_before_storing(monkeypatch):
    """Lo grabado en el navegador llega como webm/opus (o mp4/aac en Safari):
    Meta Cloud API acepta el envío igual, pero nunca lo reproduce como nota
    de voz del otro lado y el mensaje se queda sin doble check para siempre.
    Por eso se convierte a Ogg/Opus antes de guardar, salvo que ya venga en
    ese formato."""
    queued = {
        "id": 79, "sender": "vendedor", "content": None,
        "sent_at": "2026-07-21T12:00:00.000000Z",
        "media_url": "/api/media/audio/voice.ogg", "wa_message_id": None,
        "outbox_status": "queued",
    }
    patch_chats(monkeypatch, "_require_existing_lead", AsyncMock())
    open_service_window(monkeypatch)
    save_calls = []
    patch_chats(
        monkeypatch, "save_decoded_media",
        lambda content_type, raw: (save_calls.append((content_type, raw)), queued["media_url"])[1],
    )
    transcode = lambda data: b"ogg-bytes"
    patch_chats(monkeypatch, "transcode_audio_to_ogg_opus", transcode)
    patch_chats(monkeypatch, "queue_messages", AsyncMock(return_value=[queued]))

    await chats.send_audio(
        CHAT_ID,
        SendMediaRequest(content_type="audio/webm;codecs=opus", data_base64="QUJD"),
        USER,
    )

    assert save_calls == [("audio/ogg", b"ogg-bytes")]


@pytest.mark.asyncio
async def test_audio_send_falls_back_to_original_when_transcode_fails(monkeypatch):
    """Si ffmpeg no está disponible o falla, mejor mandar el audio original
    (aunque quizás no marque doble check) que no mandar nada."""
    queued = {
        "id": 80, "sender": "vendedor", "content": None,
        "sent_at": "2026-07-21T12:00:00.000000Z",
        "media_url": "/api/media/audio/voice.webm", "wa_message_id": None,
        "outbox_status": "queued",
    }
    patch_chats(monkeypatch, "_require_existing_lead", AsyncMock())
    open_service_window(monkeypatch)
    save_calls = []
    patch_chats(
        monkeypatch, "save_decoded_media",
        lambda content_type, raw: (save_calls.append((content_type, raw)), queued["media_url"])[1],
    )

    def _boom(_data):
        raise AudioTranscodeError("ffmpeg no está disponible")

    patch_chats(monkeypatch, "transcode_audio_to_ogg_opus", _boom)
    patch_chats(monkeypatch, "queue_messages", AsyncMock(return_value=[queued]))

    await chats.send_audio(
        CHAT_ID,
        SendMediaRequest(content_type="audio/webm;codecs=opus", data_base64="QUJD"),
        USER,
    )

    assert save_calls == [("audio/webm;codecs=opus", b"ABC")]


@pytest.mark.asyncio
async def test_location_send_returns_pending_job(monkeypatch):
    queued = {
        "id": 79, "sender": "vendedor",
        "content": None,
        "sent_at": "2026-07-21T12:00:00.000000Z", "media_url": None,
        "wa_message_id": None, "outbox_status": "queued",
    }
    patch_chats(monkeypatch, "_require_existing_lead", AsyncMock())
    open_service_window(monkeypatch)
    enqueue = AsyncMock(return_value=[queued])
    patch_chats(monkeypatch, "queue_messages", enqueue)

    result = await chats.send_location(
        CHAT_ID,
        SendLocationRequest(latitude=-12.1, longitude=-77.0),
        USER,
    )

    assert result["outbox_status"] == "queued"
    enqueue.assert_awaited_once()


@pytest.mark.asyncio
async def test_retry_reuses_failed_message_instead_of_creating_a_duplicate(monkeypatch):
    retried = {
        "id": 80, "sender": "vendedor", "content": "Hola",
        "sent_at": "2026-07-21T12:00:00.000000Z", "media_url": None,
        "wa_message_id": None, "outbox_status": "queued",
    }
    retry = AsyncMock(return_value=retried)
    patch_chats(monkeypatch, "retry_failed_message", retry)

    result = await chats.retry_message(CHAT_ID, 80)

    assert result["id"] == 80
    retry.assert_awaited_once_with(CHAT_ID, 80)
