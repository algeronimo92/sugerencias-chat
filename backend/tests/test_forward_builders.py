"""Reglas de reenvío: qué ítem de outbox produce cada tipo de mensaje guardado."""

import pytest

from services.chat_messaging import FORWARD_RULES, forward_item
from services.lead_updates import lead_column_values


def message(**overrides):
    defaults = {
        "message_type": "text", "content": "Hola", "media_url": None, "payload": {},
    }
    return {**defaults, **overrides}


@pytest.mark.parametrize(("kind", "mediatype"), [
    ("image", "image"),
    ("video", "video"),
    ("ptv", "video"),
    ("document", "document"),
])
def test_media_keeps_its_file_and_caption(kind, mediatype):
    item = forward_item(message(
        message_type=kind, content=" Mirá esto ", media_url="/media/x.jpg",
        payload={"filename": "x.jpg"},
    ))

    assert item["media_url"] == "/media/x.jpg"
    assert item["payload"] == {
        "type": "media", "media_url": "/media/x.jpg", "mediatype": mediatype,
        "filename": "x.jpg", "caption": "Mirá esto",
    }
    assert item["forwarded"] is True


@pytest.mark.parametrize("kind", ["audio", "sticker"])
def test_audio_and_sticker_travel_without_caption(kind):
    item = forward_item(message(message_type=kind, content="<audio></audio>", media_url="/media/a.ogg"))

    assert item["content"] is None
    assert item["payload"] == {"type": kind, "media_url": "/media/a.ogg"}


def test_an_attachment_whose_file_is_gone_falls_back_to_its_caption():
    item = forward_item(message(message_type="image", content="Mirá esto", media_url=None))

    assert item["payload"] == {"type": "text", "text": "Mirá esto"}


def test_an_attachment_without_file_or_caption_cannot_be_forwarded():
    assert forward_item(message(message_type="image", content="", media_url=None)) is None


def test_location_carries_its_coordinates():
    item = forward_item(message(
        message_type="location", content="<location>-12.1,-77.0</location>",
        payload={"latitude": -12.1, "longitude": -77.0},
    ))

    assert item["payload"] == {"type": "location", "latitude": -12.1, "longitude": -77.0}


def test_a_location_without_coordinates_is_dropped_instead_of_sent_as_text():
    """El contenido de una ubicación es un marcador interno: reenviarlo como
    texto mandaría "<location>...</location>" al cliente."""
    item = forward_item(message(
        message_type="location", content="<location>-12.1,-77.0</location>", payload={},
    ))

    assert item is None


@pytest.mark.parametrize("kind", ["text", "template", "interactive", "poll", "contact"])
def test_what_cannot_be_rebuilt_travels_as_plain_text(kind):
    item = forward_item(message(message_type=kind, content="Opción A"))

    assert item["payload"] == {"type": "text", "text": "Opción A"}


def test_a_reaction_has_nothing_to_forward():
    assert forward_item(message(message_type="reaction", content=None)) is None


def test_every_rule_builds_an_outbox_item_marked_as_forwarded():
    built = [
        forward_item(message(
            message_type=kind, media_url="/media/x.bin",
            payload={"latitude": 1, "longitude": 2},
        ))
        for kind in FORWARD_RULES
    ]

    assert all(item and item["forwarded"] is True for item in built)


def test_lead_update_maps_api_fields_to_columns():
    assert lead_column_values({"name": "Ana", "secondary_phone": "999"}) == {
        "nombre": "Ana", "telefono_secundario": "999",
    }


@pytest.mark.parametrize("field", ["con_especialista", "automatizacion_pausada", "conversacion_abierta"])
def test_an_explicit_null_on_a_not_null_column_is_ignored(field):
    assert lead_column_values({field: None, "name": "Ana"}) == {"nombre": "Ana"}
    assert lead_column_values({field: False}) == {field: False}
