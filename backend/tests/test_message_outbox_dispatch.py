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
    assert set(OUTBOUND_KINDS) == {"text", "audio", "media", "sticker", "location", "contact", "official_template", "interactive"}


def test_unknown_kind_is_rejected_at_enqueue_time():
    """Un payload saliente lo arma esta app, así que un tipo que el registro no
    conoce siempre es un error de programación. Antes se guardaba como
    "unsupported" y reventaba recién en el worker: quedaba una fila muerta en la
    outbox y una burbuja fallida en el chat del cliente.

    Distinto del "unsupported" de entrada, que sí es un tipo válido: ahí el que
    manda algo que no entendemos es WhatsApp.
    """
    with pytest.raises(ValueError, match="carousel"):
        outbound_message_fields({"type": "carousel"})


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


async def test_contact_job_keeps_all_contacts_in_one_native_message():
    sender = FakeSender()
    contacts = [
        {"fullName": "Ana Torres", "phoneNumber": "+51911111111"},
        {"fullName": "Luis Pérez", "phoneNumber": "+51922222222"},
    ]

    assert outbound_message_fields({"type": "contact", "contacts": contacts}) == (
        "contact", {"contacts": contacts},
    )
    await send_outbound(sender, CHAT_ID, {
        "type": "contact", "contacts": contacts, "quoted": {"wa_message_id": "WA-1"},
    })

    assert sender.only_call() == (
        "send_contacts", (CHAT_ID, contacts), {"quoted": {"wa_message_id": "WA-1"}},
    )


async def test_official_template_with_image_header_uploads_it_and_prepends_header_component(monkeypatch):
    """Sin el componente HEADER, Meta rechaza el envío con 132012 ("Parameter
    format does not match format in the created template") porque la
    plantilla real tiene encabezado de imagen y el envío no traía ninguno.
    La imagen se sube acá (no al encolar) para no arrastrar un media id que
    ya pudo vencer para cuando el outbox realmente despacha."""
    read_bytes = Mock(return_value=b"IMG-BYTES")
    monkeypatch.setattr(outbound_kinds, "read_media_bytes", read_bytes)
    sender = FakeSender(media_id="MEDIA-HEADER-1")

    await send_outbound(sender, CHAT_ID, {
        "type": "official_template",
        "name": "promo",
        "language": "es_PE",
        "components": [{"type": "body", "parameters": [{"type": "text", "text": "Ana"}]}],
        "header_media": {
            "media_url": "/api/media/images/encabezado.jpg",
            "content_type": "image/jpeg",
            "filename": "encabezado.jpg",
        },
    })

    read_bytes.assert_called_once_with("/api/media/images/encabezado.jpg")
    assert sender.uploads == [(b"IMG-BYTES", "image/jpeg", "encabezado.jpg")]
    assert sender.only_call() == (
        "send_template",
        (
            CHAT_ID, "promo", "es_PE",
            [
                {"type": "header", "parameters": [{"type": "image", "image": {"id": "MEDIA-HEADER-1"}}]},
                {"type": "body", "parameters": [{"type": "text", "text": "Ana"}]},
            ],
        ),
        {},
    )


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


def test_outbound_message_fields_keeps_official_template_header_footer_buttons():
    """wsp_messages.payload debe traer header/pie/botones para que la burbuja
    los pinte (parseOutboundOfficialTemplate en message.ts); antes solo
    guardaba name/language y la plantilla se veía solo con el body, sin nada
    de lo que Meta ya aprobó como parte del mensaje."""
    message_type, db_payload = outbound_message_fields({
        "type": "official_template",
        "name": "promo_verano",
        "language": "es",
        "components": [{"type": "body", "parameters": [{"type": "text", "text": "Ana"}]}],
        "header_media": None,
        "header_text": "DermicaPro",
        "footer": "Gracias por tu preferencia",
        "buttons": [{"type": "quick_reply", "text": "Confirmar"}],
    })

    assert message_type == "template"
    assert db_payload == {
        "type": "official_template",
        "name": "promo_verano",
        "language": "es",
        "header_text": "DermicaPro",
        "header_image_url": None,
        "footer": "Gracias por tu preferencia",
        "buttons": [{"type": "quick_reply", "text": "Confirmar"}],
    }


def test_outbound_message_fields_keeps_official_template_header_image_url():
    """La imagen de encabezado ya está en el storage de medios de la app desde
    que la plantilla se creó/importó -- alcanza con guardar esa misma URL acá
    para que la burbuja la muestre, sin volver a subirla por mensaje."""
    _message_type, db_payload = outbound_message_fields({
        "type": "official_template",
        "name": "promo_verano",
        "language": "es",
        "components": [],
        "header_media": {
            "media_url": "/api/media/images/encabezado.jpg",
            "content_type": "image/jpeg",
            "filename": "encabezado.jpg",
        },
        "header_text": None,
        "footer": None,
        "buttons": [],
    })

    assert db_payload["header_image_url"] == "/api/media/images/encabezado.jpg"


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
