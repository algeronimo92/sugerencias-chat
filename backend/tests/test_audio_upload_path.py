"""Una nota de voz no debe decodificarse (ni recodificarse) más de una vez.

El audio viaja en base64 dentro del JSON y el límite es de 25 MB: cada
decodificación extra es otra copia del archivo en memoria por request.
"""

import base64
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from models.schemas import SendMediaRequest
from routers import chats
from tests.conftest import open_service_window, patch_chats
import base64
from fastapi import HTTPException
from services.media_storage import AudioTranscodeError

CHAT_ID = "51999@s.whatsapp.net"
SELLER = SimpleNamespace(id=7, role="vendedor")
RAW = b"WEBM-AUDIO"
# Se codifica antes de que el fixture instrumente base64.
PAYLOAD = base64.b64encode(RAW).decode("ascii")


@pytest.fixture
def audio_route(monkeypatch):
    decoded: list[bytes] = []
    encoded: list[bytes] = []
    original_decode, original_encode = base64.b64decode, base64.b64encode

    def counting_decode(value, **kwargs):
        result = original_decode(value, **kwargs)
        decoded.append(result)
        return result

    def counting_encode(value):
        encoded.append(value)
        return original_encode(value)

    patch_chats(monkeypatch, "lead_exists", AsyncMock(return_value=True))
    open_service_window(monkeypatch)
    patch_chats(monkeypatch, "_resolve_reply_to", AsyncMock(return_value=None))
    patch_chats(monkeypatch, "enqueue_messages", AsyncMock(return_value=[{"id": 1, "status": "PENDING"}]))
    patch_chats(monkeypatch, "manager", SimpleNamespace(broadcast=AsyncMock()))
    monkeypatch.setattr(base64, "b64decode", counting_decode)
    monkeypatch.setattr(base64, "b64encode", counting_encode)
    return decoded, encoded


async def test_transcoded_audio_is_decoded_once_and_never_re_encoded(audio_route, monkeypatch):
    decoded, encoded = audio_route
    saved: list[tuple[str, bytes]] = []
    patch_chats(monkeypatch, "transcode_audio_to_ogg_opus", lambda raw: b"OGG-" + raw)
    patch_chats(monkeypatch, "save_decoded_media", lambda content_type, raw: saved.append((content_type, raw)) or "/media/a.ogg")

    await chats.send_audio(CHAT_ID, SendMediaRequest(
        content_type="audio/webm;codecs=opus", data_base64=PAYLOAD,
    ), SELLER)

    assert len(decoded) == 1
    assert encoded == []
    assert saved == [("audio/ogg", b"OGG-" + RAW)]


async def test_audio_that_cannot_be_transcoded_keeps_the_original_bytes(audio_route, monkeypatch):
    saved: list[tuple[str, bytes]] = []
    patch_chats(monkeypatch, "transcode_audio_to_ogg_opus", lambda raw: (_ for _ in ()).throw(AudioTranscodeError("sin ffmpeg")))
    patch_chats(monkeypatch, "save_decoded_media", lambda content_type, raw: saved.append((content_type, raw)) or "/media/a.webm")

    await chats.send_audio(CHAT_ID, SendMediaRequest(
        content_type="audio/webm", data_base64=PAYLOAD,
    ), SELLER)

    assert saved == [("audio/webm", RAW)]


async def test_invalid_base64_is_rejected_before_touching_storage(audio_route, monkeypatch):
    patch_chats(monkeypatch, "save_decoded_media", lambda *_args: pytest.fail("no debe guardar nada"))

    with pytest.raises(HTTPException) as exc:
        await chats.send_audio(CHAT_ID, SendMediaRequest(content_type="audio/ogg", data_base64="no-es-base64!"), SELLER)

    assert exc.value.status_code == 400
