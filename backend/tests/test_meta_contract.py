"""El contrato de mensajes Meta: una sola fuente, por dirección y con fixtures."""

import pytest

from scripts.export_meta_contract import TARGET, render
from app.integrations.meta.contract import (
    capability_for,
    contract,
    is_known_inbound,
    message_subtype,
)
from tests.meta_fixtures import inbound_cases, outbound_cases

INBOUND_ROOTS = {
    "text", "image", "video", "audio", "document", "sticker", "location",
    "contacts", "reaction", "interactive", "button", "order", "system",
    "unknown", "unsupported",
}
OUTBOUND_ROOTS = {
    "text", "image", "video", "audio", "document", "sticker", "location",
    "contacts", "reaction", "interactive", "template",
}
OUTBOUND_INTERACTIVE = {
    "button", "list", "product", "product_list", "catalog_message", "flow",
    "call_permission_request",
}
INBOUND_INTERACTIVE = {"button_reply", "list_reply", "nfm_reply"}


def test_roots_match_the_plan_per_direction():
    assert contract().inbound.root_types == INBOUND_ROOTS
    assert contract().outbound.root_types == OUTBOUND_ROOTS
    assert contract().outbound.subtypes["interactive"] == OUTBOUND_INTERACTIVE
    assert contract().inbound.subtypes["interactive"] == INBOUND_INTERACTIVE


def test_button_is_inbound_only_and_legacy_roots_are_gone():
    assert "button" in contract().inbound.root_types
    assert "button" not in contract().outbound.root_types
    for legacy in ("contact", "ptv", "poll", "pin", "product", "payment", "view_once"):
        assert legacy not in contract().inbound.root_types | contract().outbound.root_types


@pytest.mark.parametrize("root", sorted(INBOUND_ROOTS))
def test_every_inbound_root_has_a_fixture(root):
    roots = {case["message"]["type"] for case in inbound_cases().values()}
    assert root in roots


@pytest.mark.parametrize("subtype", sorted(INBOUND_INTERACTIVE))
def test_every_inbound_interactive_subtype_has_a_fixture(subtype):
    subtypes = {
        message_subtype(case["message"])
        for case in inbound_cases().values()
        if case["message"]["type"] == "interactive"
    }
    assert subtype in subtypes


@pytest.mark.parametrize("root", sorted(OUTBOUND_ROOTS))
def test_every_outbound_root_has_a_fixture(root):
    assert root in {body["type"] for body in outbound_cases().values()}


@pytest.mark.parametrize("subtype", sorted(OUTBOUND_INTERACTIVE))
def test_every_outbound_interactive_subtype_has_a_fixture(subtype):
    subtypes = {
        body["interactive"]["type"]
        for body in outbound_cases().values()
        if body["type"] == "interactive"
    }
    assert subtype in subtypes


def test_subtype_is_read_literally_from_the_nested_object():
    cases = inbound_cases()
    assert message_subtype(cases["interactive_nfm_reply"]["message"]) == "nfm_reply"
    assert message_subtype(cases["system"]["message"]) == "user_changed_number"
    assert message_subtype(cases["button"]["message"]) is None
    assert message_subtype(cases["text"]["message"]) is None


def test_unknown_future_types_are_not_known_but_are_not_rewritten():
    message = inbound_cases()["future_type"]["message"]
    assert message["type"] == "poll_v9"
    assert not is_known_inbound(message["type"], message_subtype(message))
    assert is_known_inbound("interactive", "button_reply")
    assert not is_known_inbound("interactive", "button")


def test_capabilities_are_declared_per_subtype():
    assert capability_for("interactive", "product") == "catalog"
    assert capability_for("interactive", "product_list") == "catalog"
    assert capability_for("interactive", "catalog_message") == "catalog"
    assert capability_for("interactive", "flow") == "flow"
    assert capability_for("interactive", "call_permission_request") == "call_permission"
    assert capability_for("template", None) == "approved_template"
    assert capability_for("interactive", "button") is None
    assert capability_for("text", None) is None


def test_frontend_contract_is_generated_from_the_backend_json():
    if not TARGET.parent.exists():
        pytest.skip("El frontend no está disponible en este entorno")
    assert TARGET.read_text(encoding="utf-8") == render(), (
        "Correr `python -m scripts.export_meta_contract` desde backend/"
    )
