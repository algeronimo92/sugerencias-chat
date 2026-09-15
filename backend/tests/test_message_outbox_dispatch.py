from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from services import outbound_kinds
from services.outbound_kinds import OUTBOUND_KINDS, outbound_message_fields, send_outbound
from tests.conftest import FakeSender

CHAT_ID = "51999@s.whatsapp.net"


@pytest.fixture
def stored_media(monkeypatch):
    def install(content_type: str, content: bytes):
        stat = Mock(return_value=SimpleNamespace(content_type=content_type))
        read = Mock(return_value=content)
        monkeypatch.setattr(outbound_kinds, "stat_media", stat)
        monkeypatch.setattr(outbound_kinds, "read_media_bytes", read)
        return stat, read

    return install


def test_every_outbound_kind_declares_fields_and_sender():
    assert set(OUTBOUND_KINDS) == {"text", "audio", "media", "sticker", "location", "official_template", "interactive"}


def test_unknown_kind_is_stored_as_unsupported():
    assert outbound_message_fields({"type": "carousel"}) == ("unsupported", None)


async def test_unknown_kind_is_rejected_before_reaching_the_channel():
    sender = FakeSender()

    with pytest.raises(ValueError):
        await send_outbound(sender, CHAT_ID, {"type": "carousel"})

    assert sender.calls == []


async def test_audio_job_reads_durable_media_and_delegates_to_the_channel(stored_media):
    stat, read = stored_media("audio/ogg", b"AUDIO-BYTES")
    sender = FakeSender()

    delivery = await send_outbound(sender, CHAT_ID, {"type": "audio", "media_url": "/api/media/audio/test.ogg"})

    assert delivery.receipt.provider_message_id == "WA-send_audio"
    assert delivery.delivered_content is None
    stat.assert_called_once_with("/api/media/audio/test.ogg")
    read.assert_called_once_with("/api/media/audio/test.ogg")
    assert sender.only_call() == ("send_audio", (CHAT_ID, b"AUDIO-BYTES", "audio/ogg", "test.ogg"), {"quoted": None})


async def test_media_job_preserves_type_filename_and_caption(stored_media):
    stored_media("video/mp4", b"VIDEO-BYTES")
    sender = FakeSender()

    await send_outbound(sender, CHAT_ID, {
        "type": "media", "media_url": "/api/media/videos/demo.mp4", "mediatype": "video",
        "filename": "demo.mp4", "caption": "Hola Ana, mira este video",
    })

    assert sender.only_call() == (
        "send_media",
        (CHAT_ID, b"VIDEO-BYTES", "video/mp4", "video"),
        {"filename": "demo.mp4", "caption": "Hola Ana, mira este video", "quoted": None},
    )


async def test_location_and_official_template_jobs_reach_the_channel():
    sender = FakeSender()

    await send_outbound(sender, CHAT_ID, {"type": "location", "latitude": -12.1, "longitude": -77.0})
    await send_outbound(sender, CHAT_ID, {
        "type": "official_template", "name": "appointment", "language": "es_PE",
        "components": [{"type": "body", "parameters": []}],
    })

    assert sender.calls == [
        ("send_location", (CHAT_ID, -12.1, -77.0), {"quoted": None}),
        ("send_template", (CHAT_ID, "appointment", "es_PE", [{"type": "body", "parameters": []}]), {}),
    ]


def test_outbound_message_fields_keeps_interactive_config_for_chat_display():
    config = {
        "title": "Turnos", "footer": "DermicaPro",
        "buttons": [{"type": "reply", "displayText": "Mañana", "id": "reply_1"}],
    }

    assert outbound_message_fields({
        "type": "interactive", "interactive_type": "buttons", "description": "Elige una opción", "config": config,
    }) == ("interactive", {
        "type": "interactive", "interactive_type": "buttons", "description": "Elige una opción", "config": config,
    })


async def test_reply_only_buttons_are_sent_natively():
    sender = FakeSender()

    delivery = await send_outbound(sender, CHAT_ID, {
        "type": "interactive", "interactive_type": "buttons", "description": "Elige una opción",
        "config": {"title": "Turnos", "footer": "DermicaPro", "buttons": [{"type": "reply", "displayText": "Mañana"}]},
    })

    assert delivery.delivered_content is None
    assert sender.only_call()[0] == "send_buttons"


async def test_non_reply_buttons_fall_back_to_text():
    sender = FakeSender()

    delivery = await send_outbound(sender, CHAT_ID, {
        "type": "interactive", "interactive_type": "buttons", "description": "Hola, lee esto",
        "config": {
            "title": "Presiona un boton", "footer": "DermicaPro",
            "buttons": [{"type": "url", "displayText": "Abrir enlace", "url": "https://cliniventas.com/"}],
        },
    })

    assert "Abrir enlace: https://cliniventas.com/" in delivery.delivered_content
    assert sender.only_call() == ("send_text", (CHAT_ID, delivery.delivered_content), {})


async def test_list_interactive_is_sent_natively():
    sender = FakeSender()
    sections = [{"title": "Faciales", "rows": [{"title": "Limpieza", "description": "60 min", "rowId": "trat_limpieza"}]}]

    await send_outbound(sender, CHAT_ID, {
        "type": "interactive", "interactive_type": "list", "description": "Elegí un tratamiento",
        "config": {"title": "Tratamientos", "footerText": "DermicaPro", "buttonText": "Ver opciones", "sections": sections},
    })

    assert sender.only_call() == (
        "send_list",
        (CHAT_ID, "Tratamientos", "Elegí un tratamiento", "DermicaPro", "Ver opciones", sections),
        {},
    )
