"""La validación de plantillas ya no necesita FastAPI: son errores de dominio."""

import pytest

from services.template_validation import (
    META_BUTTON_BUILDERS,
    OFFICIAL_BUTTON_RULES,
    TemplateValidationError,
    build_meta_components,
    normalize_common_fields,
    render_official_body,
    template_parameter_identifiers,
    template_variables,
    validate_internal_variables,
    validate_template_values,
)


def official(**overrides):
    defaults = {
        "name": "Recordatorio", "content": "Hola {{1}}", "category": "General",
        "template_type": "official", "official_name": "recordatorio",
        "official_language": "es_PE", "official_category": "UTILITY",
        "official_parameter_values": ["nombre"], "official_buttons": [],
    }
    return {**defaults, **overrides}


def test_the_two_button_registries_cover_the_same_types():
    assert set(OFFICIAL_BUTTON_RULES) == set(META_BUTTON_BUILDERS)


def test_template_parameter_identifiers_positional_deduplicates_positions():
    assert template_parameter_identifiers(
        "Hola {{1}}, tu turno es {{2}}. Gracias {{1}}."
    ) == ["1", "2"]


def test_template_parameter_identifiers_named_keeps_each_occurrence():
    assert template_parameter_identifiers(
        "Hola {{cliente}}, tu turno es {{fecha}}."
    ) == ["cliente", "fecha"]


def test_render_official_body_positional_reuses_value_for_repeated_position():
    rendered = render_official_body(
        "Hola {{1}}, tu turno es {{2}}. Gracias {{1}}.", ["Ana", "martes"],
    )
    assert rendered == "Hola Ana, tu turno es martes. Gracias Ana."


def test_render_official_body_named_substitutes_each_occurrence_in_order():
    rendered = render_official_body(
        "Hola {{cliente}}, tu turno es {{fecha}}.", ["Ana", "martes"],
    )
    assert rendered == "Hola Ana, tu turno es martes."


def test_variables_are_found_inside_nested_config():
    assert template_variables({"a": ["{{nombre}}", {"b": "{{ servicio }}"}]}) == {"nombre", "servicio"}


def test_an_unknown_variable_is_rejected_by_name():
    with pytest.raises(TemplateValidationError, match=r"\{\{inventada\}\}"):
        validate_internal_variables("Hola {{inventada}}")


def test_the_shortcut_is_normalized_without_its_slash():
    values = {"name": "N", "content": "C", "category": "General", "shortcut": "/Saludo"}

    normalize_common_fields(values)

    assert values["shortcut"] == "saludo"


@pytest.mark.parametrize(("field", "value"), [
    ("official_name", "Con Mayúsculas"),
    ("official_language", "espanol"),
    ("official_category", ""),
])
async def test_official_metadata_is_validated(field, value):
    with pytest.raises(TemplateValidationError):
        await validate_template_values(official(**{field: value}))


async def test_official_variables_must_be_consecutive():
    with pytest.raises(TemplateValidationError, match="consecutivas"):
        await validate_template_values(official(
            content="Hola {{1}} y {{3}}", official_parameter_values=["a", "b"],
        ))


async def test_official_content_rejects_variables_by_name():
    with pytest.raises(TemplateValidationError, match="numéricas"):
        await validate_template_values(official(
            content="Hola {{nombre}}", official_parameter_values=[],
        ))


async def test_a_url_button_needs_a_full_https_url():
    with pytest.raises(TemplateValidationError, match="https://"):
        await validate_template_values(official(
            official_buttons=[{"type": "url", "text": "Ver", "url": "example.com"}],
        ))


async def test_a_phone_button_keeps_only_its_digits():
    values = await validate_template_values(official(
        official_buttons=[{"type": "phone_number", "text": "Llamar", "phone_number": "+51 (999) 888-777"}],
    ))

    assert values["official_buttons"] == [
        {"type": "phone_number", "text": "Llamar", "phone_number": "+51999888777"},
    ]


async def test_quick_replies_cannot_be_mixed_with_the_other_kinds():
    with pytest.raises(TemplateValidationError, match="no pueden mezclarse"):
        await validate_template_values(official(official_buttons=[
            {"type": "quick_reply", "text": "Sí"},
            {"type": "url", "text": "Ver", "url": "https://example.com"},
        ]))


async def test_two_buttons_cannot_repeat_their_text():
    with pytest.raises(TemplateValidationError, match="texto único"):
        await validate_template_values(official(official_buttons=[
            {"type": "quick_reply", "text": "Sí"},
            {"type": "quick_reply", "text": "sí"},
        ]))


async def test_an_internal_template_clears_every_official_field():
    values = await validate_template_values({
        "name": "N", "content": "Hola {{nombre}}", "category": "General",
        "template_type": "internal", "interactive_type": "none",
        "official_name": "quedo_colgado", "official_buttons": [{"type": "quick_reply", "text": "x"}],
    })

    assert values["official_name"] is None
    assert values["official_buttons"] == []


async def test_meta_components_follow_the_graph_api_shape():
    values = await validate_template_values(official(
        official_footer="Equipo", content="Hola {{1}}",
        official_buttons=[{"type": "quick_reply", "text": "Sí"}],
    ))

    components = await build_meta_components(values)

    assert components == [
        {"type": "BODY", "text": "Hola {{1}}"},
        {"type": "FOOTER", "text": "Equipo"},
        {"type": "BUTTONS", "buttons": [{"type": "QUICK_REPLY", "text": "Sí"}]},
    ]
