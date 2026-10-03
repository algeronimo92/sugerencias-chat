"""IA y automatizaciones sobre el contrato Meta (fase 7 del plan)."""

from datetime import datetime, timezone

import pytest

from app.modules.automations.ports.types import FlowConditionType
from app.modules.automations.domain.conditions import match_flow_condition
from app.modules.automations.domain.validation import normalize_flow_condition
from app.integrations.meta.contract import message_subtype
from app.integrations.meta.text import message_text
from app.integrations.meta_webhook.projection import reply_identifier
from tests.conftest import make_chat
from tests.meta_fixtures import inbound_cases, inbound_message


def _text_of(name: str) -> str:
    message = inbound_message(name)
    return message_text(message["type"], message_subtype(message), None, message)


def test_structured_replies_are_described_with_their_literal_ids():
    assert _text_of("button") == "Tocó el botón de la plantilla: OpcionA (payload OpcionA)"
    assert _text_of("interactive_button_reply") == "Tocó el botón: Agendar cita (id agendar)"
    assert _text_of("interactive_list_reply") == "Eligió de la lista: Limpieza facial (id facial)"
    assert _text_of("interactive_nfm_reply").startswith("Respondió el formulario flow: ")
    assert '"flow_token": "reserva-42"' in _text_of("interactive_nfm_reply")


def test_orders_keep_products_quantities_prices_and_currency():
    assert _text_of("order") == (
        "Pedido: 2 x SKU-001 (45.5 PEN); 1 x SKU-002 (120 PEN). Quiero estos productos"
    )


def test_locations_contacts_and_unsupported_are_readable_without_inventing():
    assert _text_of("location") == "Ubicación: Plaza Mayor (-12.0464, -77.0428)"
    assert _text_of("contacts").startswith("Contacto compartido: Ana Pérez +51 912 345 678")
    assert _text_of("unsupported") == "[mensaje no soportado por WhatsApp: Message type unknown]"
    assert _text_of("future_type") == "[poll_v9]"
    assert message_text("image", None, "Así está mi piel", inbound_message("image")) == "[imagen] Así está mi piel"


@pytest.mark.parametrize(("name", "expected"), [
    ("button", "OpcionA"),
    ("interactive_button_reply", "agendar"),
    ("interactive_list_reply", "facial"),
    ("interactive_nfm_reply", None),
    ("text", None),
])
def test_reply_identifier_reads_the_id_the_business_defined(name, expected):
    message = inbound_cases()[name]["message"]
    assert reply_identifier(message["type"], message) == expected


@pytest.mark.parametrize(("condition", "context", "expected"), [
    ({"condition_type": "reply_id_equals", "value": "agendar"}, {"reply_id": "agendar"}, True),
    ({"condition_type": "reply_id_equals", "value": "agendar"}, {"reply_id": "cancelar"}, False),
    ({"condition_type": "reply_id_equals", "value": "OpcionA"}, {"reply_id": None, "content": "OpcionA"}, False),
    ({"condition_type": "message_type_equals", "value": "order"}, {"message_type": "order"}, True),
    (
        {"condition_type": "message_type_equals", "value": "interactive/nfm_reply"},
        {"message_type": "interactive", "message_subtype": "nfm_reply"},
        True,
    ),
    (
        {"condition_type": "message_type_equals", "value": "interactive"},
        {"message_type": "interactive", "message_subtype": "button_reply"},
        True,
    ),
    ({"condition_type": "message_type_equals", "value": "image"}, {"message_type": "text"}, False),
])
def test_flow_conditions_read_the_meta_structure(condition, context, expected):
    matches, _detail = match_flow_condition(condition, make_chat(), context, now=datetime.now(timezone.utc))
    assert matches is expected


@pytest.mark.parametrize("condition_type", [FlowConditionType.REPLY_ID_EQUALS, FlowConditionType.MESSAGE_TYPE_EQUALS])
def test_structural_conditions_require_a_value(condition_type):
    normalized, _user, _tag = normalize_flow_condition({"condition_type": condition_type, "value": " order "}, 1)
    assert normalized == {"condition_type": condition_type, "value": "order"}
    with pytest.raises(ValueError):
        normalize_flow_condition({"condition_type": condition_type, "value": ""}, 1)
