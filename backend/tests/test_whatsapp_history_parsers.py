"""Contrato del registro que traduce cada nodo de WhatsApp al hilo.

Cada clave que WhatsApp puede mandar tiene que resolver a un `message_type` de
nuestra taxonomía, y el orden del registro decide qué gana cuando hay varias.
Lo que no reconoce nadie cae en `unsupported` con su tipo original, que es como
descubrimos qué tipos nuevos manda la cuenta.
"""

import pytest

from services.whatsapp_history.content import MESSAGE_PARSERS, _content_from_message

NODES = {
    "conversation": ("hola", "text"),
    "extendedTextMessage": ({"text": "hola larga"}, "text"),
    "imageMessage": ({"caption": "mira"}, "image"),
    "videoMessage": ({"caption": "video"}, "video"),
    "ptvMessage": ({"caption": ""}, "ptv"),
    "audioMessage": ({"seconds": 3}, "audio"),
    "documentMessage": ({"fileName": "cv.pdf"}, "document"),
    "locationMessage": ({"degreesLatitude": -12.1, "degreesLongitude": -77.0}, "location"),
    "liveLocationMessage": ({"degreesLatitude": -12.1, "degreesLongitude": -77.0}, "location"),
    "stickerMessage": ({"mimetype": "image/webp"}, "sticker"),
    "lottieStickerMessage": ({}, "sticker"),
    "pinInChatMessage": ({"key": {"id": "WA-1"}, "type": 2}, "pin"),
    "contactMessage": ({"displayName": "Ana", "vcard": "TEL;waid=51999:+51 999"}, "contact"),
    "contactsArrayMessage": ({"contacts": [{"displayName": "Ana", "vcard": "x"}]}, "contact"),
    "pollCreationMessage": ({"name": "Color?", "options": [{"optionName": "Rojo"}]}, "poll"),
    "pollCreationMessageV2": ({"name": "C2", "options": []}, "poll"),
    "pollCreationMessageV3": ({"name": "C3", "options": []}, "poll"),
    "pollCreationMessageV4": ({"name": "C4", "options": []}, "poll"),
    "pollCreationMessageV5": ({"name": "C5", "options": []}, "poll"),
    "pollResultSnapshotMessage": ({"name": "R", "pollVotes": []}, "poll"),
    "pollResultSnapshotMessageV3": ({"name": "R3", "pollVotes": []}, "poll"),
    "orderMessage": ({"orderId": "9", "orderTitle": "Pedido"}, "order"),
    "productMessage": ({"product": {"productId": "p1", "title": "Botox"}}, "product"),
    "invoiceMessage": ({"amount1000": 5000, "note": "factura"}, "payment"),
    "requestPaymentMessage": ({"amount": 100, "status": "pending"}, "payment"),
    "sendPaymentMessage": ({"noteMessage": "pagado"}, "payment"),
    "paymentInviteMessage": ({"serviceType": "UPI"}, "payment"),
    "cancelPaymentRequestMessage": ({"transactionId": "t1"}, "payment"),
    "declinePaymentRequestMessage": ({"status": "declined"}, "payment"),
    "buttonsResponseMessage": ({"selectedDisplayText": "Si", "selectedButtonId": "b1"}, "interactive"),
    "templateButtonReplyMessage": ({"selectedDisplayText": "No", "selectedId": "b2"}, "interactive"),
    "listResponseMessage": ({"title": "Opcion", "singleSelectReply": {"selectedRowId": "r1"}}, "interactive"),
    "interactiveResponseMessage": (
        {"nativeFlowResponseMessage": {"paramsJson": '{"display_text":"X","id":"i1"}'}},
        "interactive",
    ),
    "buttonsMessage": ({"contentText": "elegi"}, "interactive"),
    "listMessage": ({"description": "lista"}, "interactive"),
    "interactiveMessage": ({"body": {"text": "cuerpo"}}, "interactive"),
    "templateMessage": ({"hydratedTemplate": {}}, "template"),
}


def test_every_registered_key_has_a_case_here():
    assert set(MESSAGE_PARSERS) == set(NODES)


@pytest.mark.parametrize("key", sorted(NODES))
def test_each_key_resolves_to_its_message_type(key):
    node, expected = NODES[key]

    parsed = _content_from_message({key: node})

    assert parsed is not None, f"{key} no produjo nada"
    assert parsed[1] == expected


@pytest.mark.parametrize("message", [
    {"reactionMessage": {"text": "x"}},
    {"protocolMessage": {}},
    {"senderKeyDistributionMessage": {}},
    {"pollUpdateMessage": {}},
    {"messageContextInfo": {}},
    {},
])
def test_what_has_no_place_in_the_thread_is_not_shown(message):
    assert _content_from_message(message) is None


def test_an_unknown_type_is_kept_as_unsupported_with_its_original_name():
    parsed = _content_from_message({"algoQueNoConocemos": {"x": 1}})

    assert parsed == (None, "unsupported", {"original_type": "algoQueNoConocemos"})


def test_an_empty_text_falls_through_to_the_next_key():
    """Un parser que devuelve None deja pasar a la clave siguiente en vez de
    cortar: `conversation` vacío no puede tapar la imagen que viene al lado."""
    parsed = _content_from_message({"conversation": "", "imageMessage": {"caption": "cae acá"}})

    assert parsed == ("cae acá", "image", None)


def test_a_live_location_is_marked_even_when_the_coordinates_come_in_the_static_node():
    parsed = _content_from_message({
        "locationMessage": {"degreesLatitude": 1, "degreesLongitude": 2},
        "liveLocationMessage": {},
    })

    assert parsed == (None, "location", {"live": True, "latitude": 1, "longitude": 2})


def test_view_once_is_recognised_before_unwrapping_so_it_never_looks_persistent():
    parsed = _content_from_message({
        "viewOnceMessageV2": {"message": {"imageMessage": {"caption": "secreto"}}},
    })

    assert parsed == ("secreto", "view_once", {
        "original_type": "viewOnceMessageV2", "inner_type": "image",
    })
