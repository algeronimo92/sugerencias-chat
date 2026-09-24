from unittest.mock import AsyncMock

import pytest

from services import whatsapp_rules
from services.whatsapp_rules import (
    InteractiveRuleError,
    build_interactive,
    interactive_choices,
    interactive_errors,
    normalize_interactive_config,
    resolve_default_footer,
)

BUTTON = {
    "header": {"type": "text", "text": "Turnos"},
    "action": {"buttons": [{"type": "reply", "reply": {"id": "manana", "title": "Mañana"}}]},
}
LIST = {
    "header": {"type": "text", "text": "Tratamientos"},
    "action": {
        "button": "Ver",
        "sections": [{"title": "Faciales", "rows": [{"id": "l1", "title": "Limpieza", "description": "60 min"}]}],
    },
}


def test_templates_store_only_button_and_list():
    assert normalize_interactive_config("button", BUTTON, "Clínica") == BUTTON
    assert normalize_interactive_config("list", LIST, "Clínica") == LIST
    assert normalize_interactive_config("none", BUTTON, "Clínica") == {}
    for subtype in ("buttons", "product", "flow", "carousel"):
        with pytest.raises(InteractiveRuleError):
            normalize_interactive_config(subtype, BUTTON, "Clínica")


def test_normalization_drops_type_body_and_empty_header():
    config = {**BUTTON, "type": "button", "body": {"text": "x"}, "header": {"type": "text", "text": " "}}
    assert normalize_interactive_config("button", config, "Clínica") == {"action": BUTTON["action"]}


def test_limits_come_from_the_meta_contract():
    too_long = {"action": {"buttons": [{"type": "reply", "reply": {"id": "a", "title": "x" * 21}}]}}
    with pytest.raises(InteractiveRuleError, match="20"):
        normalize_interactive_config("button", too_long, "Clínica")


def test_non_reply_buttons_are_rejected():
    url = {"action": {"buttons": [{"type": "url", "url": "https://x.com"}]}}
    with pytest.raises(InteractiveRuleError, match="reply"):
        normalize_interactive_config("button", url, "Clínica")


def test_build_adds_body_and_default_footer():
    assert build_interactive("button", BUTTON, "¿Cuándo?", "Clínica") == {
        "type": "button",
        **BUTTON,
        "body": {"text": "¿Cuándo?"},
        "footer": {"text": "Clínica"},
    }
    own_footer = {**LIST, "footer": {"text": "Propio"}}
    assert build_interactive("list", own_footer, "Elegí", "Clínica")["footer"] == {"text": "Propio"}


def test_rendered_values_report_every_problem():
    errors = interactive_errors("button", {"action": {"buttons": []}}, "", "Clínica")
    assert "El cuerpo es obligatorio" in errors
    assert any("entre 1 y 3" in error for error in errors)


def test_choices_by_type():
    assert interactive_choices("button", BUTTON) == ["Mañana"]
    assert interactive_choices("list", LIST) == ["Limpieza"]


async def test_footer_setting_is_only_read_when_the_config_has_none(monkeypatch):
    default = AsyncMock(return_value="Clínica")
    monkeypatch.setattr(whatsapp_rules, "default_interactive_footer", default)

    assert await resolve_default_footer({**BUTTON, "footer": {"text": "Propio"}}) == ""
    default.assert_not_awaited()
    assert await resolve_default_footer(LIST) == "Clínica"


async def test_default_footer_is_the_business_brand_not_another_business(monkeypatch):
    from types import SimpleNamespace
    from uuid import UUID

    from services.branding import Branding

    org = UUID("68b010ae-8f9b-4f47-ab57-c74048923081")
    monkeypatch.setattr(whatsapp_rules, "get_effective", AsyncMock(return_value=""))
    monkeypatch.setattr(whatsapp_rules, "get_current_tenant", lambda: SimpleNamespace(organization_id=org))
    monkeypatch.setattr(
        whatsapp_rules,
        "get_branding",
        AsyncMock(return_value=Branding("Clínica Norte", "#00a884", False, 0)),
    )

    assert await whatsapp_rules.default_interactive_footer() == "Clínica Norte"


async def test_configured_footer_wins_over_the_brand(monkeypatch):
    monkeypatch.setattr(whatsapp_rules, "get_effective", AsyncMock(return_value="  Te esperamos  "))
    brand = AsyncMock()
    monkeypatch.setattr(whatsapp_rules, "get_branding", brand)

    assert await whatsapp_rules.default_interactive_footer() == "Te esperamos"
    brand.assert_not_awaited()
