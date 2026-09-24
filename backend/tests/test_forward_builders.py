"""Reglas de reenvío: qué ítem de outbox produce cada tipo de mensaje guardado."""

import pytest

from services.chat_messaging import FORWARD_RULES, forward_item
from services.lead_updates import lead_column_values
from services.meta_outbound import validation_errors
from tests.meta_fixtures import inbound_message


def message(**overrides):
    defaults = {
        "message_type": "text", "content": "Hola", "media_url": None, "provider_payload": {},
    }
    return {**defaults, **overrides}


@pytest.mark.parametrize("kind", ["image", "video", "document"])
def test_media_keeps_its_file_and_caption(kind):
    received = inbound_message(kind)
    item = forward_item(message(
        message_type=kind, content=" Mirá esto ", media_url="/media/x.bin", provider_payload=received,
    ))

    assert item["media_url"] == "/media/x.bin"
    assert item["message"]["type"] == kind
    assert item["message"][kind]["caption"] == "Mirá esto"
    if kind == "document":
        assert item["message"]["document"]["filename"] == "receta.pdf"
    assert item["media"]["media_url"] == "/media/x.bin"
    assert item["forwarded"] is True
    assert validation_errors(item["message"], final=False) == []


def test_a_voice_note_is_forwarded_as_a_voice_note():
    item = forward_item(message(
        message_type="audio", content=None, media_url="/media/a.ogg", provider_payload=inbound_message("audio"),
    ))

    assert item["content"] is None
    assert item["message"] == {"type": "audio", "audio": {"voice": True}}


def test_a_sticker_is_converted_again_when_sent():
    item = forward_item(message(message_type="sticker", content=None, media_url="/media/s.webp"))

    assert item["message"] == {"type": "sticker", "sticker": {}}
    assert item["media"]["as_sticker"] is True


def test_an_attachment_whose_file_is_gone_falls_back_to_its_caption():
    item = forward_item(message(message_type="image", content="Mirá esto", media_url=None))

    assert item["message"] == {"type": "text", "text": {"body": "Mirá esto"}}


def test_an_attachment_without_file_or_caption_cannot_be_forwarded():
    assert forward_item(message(message_type="image", content="", media_url=None)) is None


def test_location_carries_the_meta_location():
    item = forward_item(message(
        message_type="location", content="Plaza Mayor", provider_payload=inbound_message("location"),
    ))

    assert item["message"] == {
        "type": "location",
        "location": {
            "latitude": -12.0464, "longitude": -77.0428,
            "name": "Plaza Mayor", "address": "Jirón de la Unión, Lima",
        },
    }


def test_a_location_without_coordinates_is_dropped_instead_of_sent_as_text():
    assert forward_item(message(message_type="location", content="Plaza", provider_payload={})) is None


def test_shared_contacts_are_forwarded_as_the_same_meta_contacts():
    received = inbound_message("contacts")
    item = forward_item(message(message_type="contacts", content="Ana Pérez, Luis Díaz", provider_payload=received))

    assert item["message"] == {"type": "contacts", "contacts": received["contacts"]}


@pytest.mark.parametrize("kind", ["text", "template", "interactive", "button", "order", "poll_v9"])
def test_what_cannot_be_rebuilt_travels_as_plain_text(kind):
    item = forward_item(message(message_type=kind, content="Opción A"))

    assert item["message"] == {"type": "text", "text": {"body": "Opción A"}}


def test_a_reaction_has_nothing_to_forward():
    assert forward_item(message(message_type="reaction", content=None)) is None


def test_every_rule_builds_an_outbox_item_marked_as_forwarded():
    built = [
        forward_item(message(
            message_type=kind, content="x", media_url="/media/x.bin",
            provider_payload={
                "location": {"latitude": 1, "longitude": 2},
                "contacts": [{"name": {"formatted_name": "Ana"}}],
            },
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
