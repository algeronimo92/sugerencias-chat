from unittest.mock import AsyncMock, Mock

import pytest

from services import message_outbox


@pytest.mark.asyncio
async def test_audio_job_reads_durable_media_and_uses_generic_media_endpoint(monkeypatch):
    """sendWhatsAppAudio (PTT) quedó roto en la instancia Meta Cloud API que
    usa la app -acepta el envío pero el mensaje nunca se entrega, sin ni un
    error- así que las notas de voz se mandan por sendMedia como adjunto de
    audio, que sí entrega (confirmado mandando el mismo archivo por los dos
    caminos y comparando el historial de Evolution)."""
    read_media = Mock(return_value="BASE64")
    send_media = AsyncMock(return_value={"key": {"id": "WA-AUDIO"}})
    monkeypatch.setattr(message_outbox, "read_media_base64", read_media)
    monkeypatch.setattr(message_outbox, "send_whatsapp_media", send_media)

    response, content = await message_outbox._send_payload(
        "51999@s.whatsapp.net",
        {"type": "audio", "media_url": "/api/media/audio/test.ogg"},
    )

    assert response["key"]["id"] == "WA-AUDIO"
    assert content is None
    read_media.assert_called_once_with("/api/media/audio/test.ogg")
    send_media.assert_awaited_once_with(
        "51999@s.whatsapp.net", "BASE64", "audio", filename="test.ogg", quoted=None
    )


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
        "51999@s.whatsapp.net", "BASE64", "document", filename="file.pdf", caption=None, quoted=None
    )


@pytest.mark.asyncio
async def test_media_template_caption_reaches_evolution_send_media(monkeypatch):
    monkeypatch.setattr(message_outbox, "read_media_base64", Mock(return_value="BASE64"))
    send_media = AsyncMock(return_value={"key": {"id": "WA-VIDEO"}})
    monkeypatch.setattr(message_outbox, "send_whatsapp_media", send_media)

    await message_outbox._send_payload("51999@s.whatsapp.net", {
        "type": "media",
        "media_url": "/api/media/videos/demo.mp4",
        "mediatype": "video",
        "filename": "demo.mp4",
        "caption": "Hola Ana, mira este video",
    })

    send_media.assert_awaited_once_with(
        "51999@s.whatsapp.net",
        "BASE64",
        "video",
        filename="demo.mp4",
        caption="Hola Ana, mira este video",
        quoted=None,
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

    send_location.assert_awaited_once_with("51999@s.whatsapp.net", -12.1, -77.0, quoted=None)
    send_template.assert_awaited_once_with(
        "51999@s.whatsapp.net", "appointment", "es_PE",
        [{"type": "body", "parameters": []}],
    )


def test_outbound_message_fields_keeps_interactive_config_for_chat_display():
    """wsp_messages.payload debe traer lo que el frontend necesita para pintar
    botones/lista reales (parseOutboundInteractive en message.ts); si solo
    queda interactive_type, la burbuja cae a texto plano aunque el envío a
    Evolution sí haya llevado los botones completos."""
    message_type, db_payload = message_outbox._outbound_message_fields({
        "type": "interactive",
        "interactive_type": "buttons",
        "description": "Elige una opción",
        "config": {
            "title": "Turnos",
            "footer": "DermicaPro",
            "buttons": [{"type": "reply", "displayText": "Mañana", "id": "reply_1"}],
        },
    })

    assert message_type == "interactive"
    assert db_payload == {
        "type": "interactive",
        "interactive_type": "buttons",
        "description": "Elige una opción",
        "config": {
            "title": "Turnos",
            "footer": "DermicaPro",
            "buttons": [{"type": "reply", "displayText": "Mañana", "id": "reply_1"}],
        },
    }


@pytest.mark.asyncio
async def test_interactive_job_uses_numbered_text_fallback_for_baileys(monkeypatch):
    monkeypatch.setattr(message_outbox, "get_instance_capabilities", AsyncMock(return_value={
        "integration": "BAILEYS", "official_sending_supported": False,
        "history_available": True, "edit_delete_supported": True,
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


@pytest.mark.asyncio
async def test_business_reply_only_buttons_are_sent_natively(monkeypatch):
    monkeypatch.setattr(message_outbox, "get_instance_capabilities", AsyncMock(return_value={
        "integration": "WHATSAPP-BUSINESS", "official_sending_supported": True,
        "history_available": False, "edit_delete_supported": False,
    }))
    send_text = AsyncMock()
    send_buttons = AsyncMock(return_value={"key": {"id": "WA-BUTTONS"}})
    monkeypatch.setattr(message_outbox, "send_whatsapp_text", send_text)
    monkeypatch.setattr(message_outbox, "send_whatsapp_buttons", send_buttons)

    response, delivered_content = await message_outbox._send_payload(
        "51999@s.whatsapp.net",
        {
            "type": "interactive",
            "interactive_type": "buttons",
            "description": "Elige una opción",
            "config": {
                "title": "Turnos", "footer": "DermicaPro",
                "buttons": [{"type": "reply", "displayText": "Mañana"}],
            },
        },
    )

    assert response["key"]["id"] == "WA-BUTTONS"
    assert delivered_content is None
    send_buttons.assert_awaited_once()
    send_text.assert_not_awaited()


@pytest.mark.asyncio
async def test_business_rejects_non_reply_buttons_and_falls_back_to_text(monkeypatch):
    """La Graph API de Meta solo acepta botones "reply" en un mensaje
    interactivo suelto (fuera de una plantilla oficial): un botón de URL
    rechaza siempre con "interactive.action.buttons.0.reply is required"
    (confirmado con tráfico real), sin importar la ventana de 24h."""
    monkeypatch.setattr(message_outbox, "get_instance_capabilities", AsyncMock(return_value={
        "integration": "WHATSAPP-BUSINESS", "official_sending_supported": True,
        "history_available": False, "edit_delete_supported": False,
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
            "description": "Hola, lee esto",
            "config": {
                "title": "Presiona un boton", "footer": "DermicaPro",
                "buttons": [{"type": "url", "displayText": "Abrir enlace", "url": "https://cliniventas.com/"}],
            },
        },
    )

    assert "Abrir enlace: https://cliniventas.com/" in delivered_content
    send_text.assert_awaited_once_with("51999@s.whatsapp.net", delivered_content)
    send_buttons.assert_not_awaited()
