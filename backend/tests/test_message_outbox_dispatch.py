from unittest.mock import AsyncMock, Mock

import pytest

from services import message_outbox


@pytest.mark.asyncio
async def test_audio_job_reads_durable_media_and_uses_ptt_endpoint(monkeypatch):
    read_media = Mock(return_value="BASE64")
    send_audio = AsyncMock(return_value={"key": {"id": "WA-AUDIO"}})
    monkeypatch.setattr(message_outbox, "read_media_base64", read_media)
    monkeypatch.setattr(message_outbox, "send_whatsapp_audio", send_audio)

    response, content = await message_outbox._send_payload(
        "51999@s.whatsapp.net",
        {"type": "audio", "media_url": "/api/media/audio/test.ogg"},
    )

    assert response["key"]["id"] == "WA-AUDIO"
    assert content is None
    read_media.assert_called_once_with("/api/media/audio/test.ogg")
    send_audio.assert_awaited_once_with("51999@s.whatsapp.net", "BASE64")


@pytest.mark.asyncio
async def test_media_job_preserves_type_and_filename(monkeypatch):
    monkeypatch.setattr(message_outbox, "read_media_base64", Mock(return_value="BASE64"))
    send_media = AsyncMock(return_value={"key": {"id": "WA-MEDIA"}})
    monkeypatch.setattr(message_outbox, "send_whatsapp_media", send_media)

    await message_outbox._send_payload("51999@s.whatsapp.net", {
        "type": "media",
        "media_url": "/api/media/documents/file.pdf",
        "mediatype": "document",
        "filename": "file.pdf",
    })

    send_media.assert_awaited_once_with(
        "51999@s.whatsapp.net", "BASE64", "document", filename="file.pdf"
    )


@pytest.mark.asyncio
async def test_location_and_official_template_jobs_dispatch_without_route_wait(monkeypatch):
    send_location = AsyncMock(return_value={"key": {"id": "WA-LOCATION"}})
    send_template = AsyncMock(return_value={"key": {"id": "WA-TEMPLATE"}})
    monkeypatch.setattr(message_outbox, "send_whatsapp_location", send_location)
    monkeypatch.setattr(message_outbox, "send_whatsapp_template", send_template)

    await message_outbox._send_payload("51999@s.whatsapp.net", {
        "type": "location", "latitude": -12.1, "longitude": -77.0,
    })
    await message_outbox._send_payload("51999@s.whatsapp.net", {
        "type": "official_template",
        "name": "appointment",
        "language": "es_PE",
        "components": [{"type": "body", "parameters": []}],
    })

    send_location.assert_awaited_once_with("51999@s.whatsapp.net", -12.1, -77.0)
    send_template.assert_awaited_once_with(
        "51999@s.whatsapp.net", "appointment", "es_PE",
        [{"type": "body", "parameters": []}],
    )


@pytest.mark.asyncio
async def test_interactive_job_uses_numbered_text_fallback_for_baileys(monkeypatch):
    monkeypatch.setattr(message_outbox, "get_template_capabilities", AsyncMock(return_value={
        "integration": "BAILEYS", "official_sending_supported": False,
    }))
    send_text = AsyncMock(return_value={"key": {"id": "WA-TEXT"}})
    send_buttons = AsyncMock()
    monkeypatch.setattr(message_outbox, "send_whatsapp_text", send_text)
    monkeypatch.setattr(message_outbox, "send_whatsapp_buttons", send_buttons)

    _response, delivered_content = await message_outbox._send_payload(
        "51999@s.whatsapp.net",
        {
            "type": "interactive",
            "interactive_type": "buttons",
            "description": "Elige una opción",
            "config": {
                "title": "Turnos",
                "footer": "DermicaPro",
                "buttons": [{"type": "reply", "displayText": "Mañana"}],
            },
        },
    )

    assert "1. Mañana" in delivered_content
    send_text.assert_awaited_once_with("51999@s.whatsapp.net", delivered_content)
    send_buttons.assert_not_awaited()
