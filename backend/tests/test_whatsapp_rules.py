from unittest.mock import AsyncMock

import pytest

from services import whatsapp_rules
from services.whatsapp_rules import (
    INTERACTIVE_RULES,
    LIMITS,
    InteractiveRuleError,
    buttons_text_fallback,
    interactive_choices_summary,
    normalize_interactive_config,
    rendered_interactive_errors,
    resolve_interactive_footer,
)

BUTTONS = {"title": "Turnos", "buttons": [{"type": "reply", "displayText": "Mañana"}]}
LIST = {
    "title": "Tratamientos", "buttonText": "Ver",
    "sections": [{"title": "Faciales", "rows": [{"title": "Limpieza", "description": "60 min", "rowId": "l1"}]}],
}


def test_every_interactive_type_has_a_rule():
    assert set(INTERACTIVE_RULES) == {"buttons", "list"}


def test_normalization_applies_default_footer_to_the_type_specific_field():
    assert normalize_interactive_config("buttons", BUTTONS, "Clínica")["footer"] == "Clínica"
    assert normalize_interactive_config("list", LIST, "Clínica")["footerText"] == "Clínica"
    assert normalize_interactive_config("none", BUTTONS, "Clínica") == {}


def test_normalization_enforces_limits():
    too_long = {**BUTTONS, "buttons": [{"type": "reply", "displayText": "x" * (LIMITS.button_text + 1)}]}

    with pytest.raises(InteractiveRuleError, match=str(LIMITS.button_text)):
        normalize_interactive_config("buttons", too_long, "Clínica")


def test_unknown_interactive_type_is_rejected():
    with pytest.raises(InteractiveRuleError):
        normalize_interactive_config("carousel", {}, "Clínica")


def test_rendered_values_report_every_problem():
    config = {"title": "", "buttons": [{"type": "url", "displayText": "Abrir", "url": "http://no-https"}]}

    errors = rendered_interactive_errors("buttons", "", config, "Clínica")

    assert "la descripción quedó vacía" in errors
    assert "el título quedó vacío" in errors
    assert "la URL del botón 1 no es válida" in errors


def test_choices_summary_by_type():
    assert interactive_choices_summary("buttons", BUTTONS) == "Mañana"
    assert interactive_choices_summary("list", LIST) == "Limpieza"


def test_text_fallback_numbers_reply_buttons_and_lists_links():
    reply = buttons_text_fallback("T", "D", "Pie", [{"type": "reply", "displayText": "Sí"}])
    link = buttons_text_fallback("T", "D", "", [{"type": "url", "displayText": "Web", "url": "https://x.com"}])

    assert "1. Sí" in reply and "Responde con el número" in reply and reply.endswith("Pie")
    assert "• Web: https://x.com" in link and "Responde con el número" not in link


async def test_footer_setting_is_only_read_when_the_config_has_none(monkeypatch):
    default = AsyncMock(return_value="Clínica")
    monkeypatch.setattr(whatsapp_rules, "default_interactive_footer", default)

    assert await resolve_interactive_footer("buttons", {**BUTTONS, "footer": "Propio"}) == "Propio"
    default.assert_not_awaited()
    assert await resolve_interactive_footer("list", LIST) == "Clínica"
