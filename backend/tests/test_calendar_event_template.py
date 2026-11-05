"""El título y la descripción del evento de Google Calendar salen de la
plantilla del negocio; sin plantilla, el evento queda como siempre."""

from unittest.mock import AsyncMock

import pytest

from app.modules.appointments.application import calendar_template
from app.modules.appointments.domain.calendar_event import (
    InvalidEventTemplate,
    render_event,
    validate_template,
)

APPOINTMENT = {
    "id": 41,
    "nombre_completo": "Gerson Portal",
    "telefono": "959696977",
    "tratamiento": "consulta",
    "detalle": "",
    "dni": "",
    "vendedor": "Admin",
    "fecha": "2026-10-21",
    "hora": "05:00",
    "duration_minutes": 60,
    "adelanto": 0,
    "custom_fields": {"sede": "Miraflores", "primera_vez": True},
}
LABELS = {"sede": "Sede", "primera_vez": "Primera vez"}


def test_without_template_the_event_looks_like_before():
    content = render_event(APPOINTMENT, LABELS)

    assert content.title == "consulta"
    assert content.description == (
        "Contacto: Gerson Portal\nTeléfono: 959696977\nResponsable: Admin\n"
        "Sede: Miraflores\nPrimera vez: Sí"
    )


def test_template_mixes_free_text_and_fields():
    content = render_event(
        APPOINTMENT, LABELS,
        title_template="{tratamiento} - {nombre_completo} ({custom.sede})",
        description_template="Paciente: {nombre_completo}\nDNI: {dni}\n\nAtiende {vendedor} a las {hora}",
    )

    assert content.title == "consulta - Gerson Portal (Miraflores)"
    # La línea del DNI desaparece porque su único campo está vacío; el
    # separador en blanco se respeta.
    assert content.description == "Paciente: Gerson Portal\n\nAtiende Admin a las 05:00"


def test_title_that_ends_empty_falls_back_to_the_service():
    content = render_event(APPOINTMENT, LABELS, title_template="{dni}")

    assert content.title == "consulta"


def test_adelanto_in_zero_is_not_shown():
    content = render_event(APPOINTMENT, LABELS, description_template="Adelanto: S/ {adelanto}")
    assert content.description == ""

    paid = render_event({**APPOINTMENT, "adelanto": 50.0}, LABELS, description_template="Adelanto: S/ {adelanto}")
    assert paid.description == "Adelanto: S/ 50"


def test_unknown_field_is_rejected():
    with pytest.raises(InvalidEventTemplate):
        validate_template("{nombre}", max_length=200)
    with pytest.raises(InvalidEventTemplate):
        validate_template("{custom.borrado}", max_length=200, custom_keys={"sede"})
    assert validate_template(" {custom.sede} ", max_length=200, custom_keys={"sede"}) == "{custom.sede}"


def test_too_long_template_is_rejected():
    with pytest.raises(InvalidEventTemplate):
        validate_template("x" * 201, max_length=200)


@pytest.fixture
def stored(monkeypatch):
    values = {calendar_template.TITLE_KEY: "", calendar_template.DESCRIPTION_KEY: ""}

    async def update(new_values):
        values.update(new_values)

    monkeypatch.setattr(calendar_template, "list_definitions", AsyncMock(return_value=[
        {"key": "sede", "label": "Sede"},
        {"key": "dni", "label": "DNI"},
    ]))
    monkeypatch.setattr(calendar_template, "get_effective_many", AsyncMock(side_effect=lambda _keys: dict(values)))
    monkeypatch.setattr(calendar_template, "update_settings", AsyncMock(side_effect=update))
    return values


async def test_template_lists_builtin_and_custom_fields(stored):
    result = await calendar_template.get_template()

    keys = [item["key"] for item in result["fields"]]
    assert keys[0] == "tratamiento"
    assert "custom.sede" in keys and keys[-1] == "campos_personalizados"
    # El DNI personalizado ya llega en el campo fijo: no se ofrece dos veces.
    assert "custom.dni" not in keys and keys.count("dni") == 1
    assert result["title_template"] == result["default_title_template"] == "{tratamiento}"


async def test_saving_the_default_stores_empty(stored):
    await calendar_template.save_template("{nombre_completo} · {tratamiento}", "{custom.sede}")
    assert stored == {
        calendar_template.TITLE_KEY: "{nombre_completo} · {tratamiento}",
        calendar_template.DESCRIPTION_KEY: "{custom.sede}",
    }

    result = await calendar_template.save_template(
        "{tratamiento}", calendar_template.DEFAULT_DESCRIPTION_TEMPLATE,
    )
    assert stored == {calendar_template.TITLE_KEY: "", calendar_template.DESCRIPTION_KEY: ""}
    assert result["title_template"] == "{tratamiento}"


async def test_event_content_uses_the_stored_template(stored):
    stored[calendar_template.TITLE_KEY] = "{nombre_completo}"

    content = await calendar_template.event_content(APPOINTMENT)

    assert content.title == "Gerson Portal"
