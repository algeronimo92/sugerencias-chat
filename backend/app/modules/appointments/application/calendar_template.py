"""La plantilla del evento de Google Calendar: cómo la edita el negocio y
cómo se aplica a cada cita."""

from __future__ import annotations

from app.modules.appointments.domain.calendar_event import (
    ALL_CUSTOM_FIELDS,
    BUILTIN_FIELDS,
    CUSTOM_PREFIX,
    DEFAULT_DESCRIPTION_TEMPLATE,
    DEFAULT_TITLE_TEMPLATE,
    MAX_DESCRIPTION_LENGTH,
    MAX_TITLE_LENGTH,
    EventContent,
    render_event,
    validate_template,
)
from app.modules.catalogs.ports.custom_fields import list_definitions
from app.modules.platform.ports.settings_service import get_effective_many, update_settings

TITLE_KEY = "google_calendar_title_template"
DESCRIPTION_KEY = "google_calendar_description_template"


async def _custom_definitions() -> list[dict]:
    return await list_definitions("appointment")


async def _stored() -> dict[str, str]:
    return await get_effective_many((TITLE_KEY, DESCRIPTION_KEY))


async def event_content(appointment: dict) -> EventContent:
    definitions = await _custom_definitions()
    stored = await _stored()
    return render_event(
        appointment,
        {item["key"]: item["label"] for item in definitions},
        title_template=stored[TITLE_KEY],
        description_template=stored[DESCRIPTION_KEY],
    )


async def get_template() -> dict:
    definitions = await _custom_definitions()
    stored = await _stored()
    fields = [
        {"key": key, "label": label, "custom": False} for key, label in BUILTIN_FIELDS.items()
    ] + [
        {"key": f"{CUSTOM_PREFIX}{item['key']}", "label": item["label"], "custom": True}
        for item in definitions
    ]
    if definitions:
        fields.append({"key": ALL_CUSTOM_FIELDS, "label": "Todos los campos personalizados", "custom": True})
    return {
        "title_template": stored[TITLE_KEY] or DEFAULT_TITLE_TEMPLATE,
        "description_template": stored[DESCRIPTION_KEY] or DEFAULT_DESCRIPTION_TEMPLATE,
        "default_title_template": DEFAULT_TITLE_TEMPLATE,
        "default_description_template": DEFAULT_DESCRIPTION_TEMPLATE,
        "fields": fields,
    }


async def save_template(title_template: str, description_template: str) -> dict:
    """Guarda la plantilla. La de siempre se guarda como vacío: así, si el
    formato por defecto cambia, le llega también a quien nunca lo tocó.
    Levanta ``InvalidEventTemplate`` si nombra un campo que no existe."""
    custom_keys = {item["key"] for item in await _custom_definitions()}
    title = validate_template(title_template, max_length=MAX_TITLE_LENGTH, custom_keys=custom_keys)
    # El título es una línea: un salto pegado se vuelve espacio.
    title = " ".join(title.split())
    description = validate_template(
        description_template, max_length=MAX_DESCRIPTION_LENGTH, custom_keys=custom_keys,
    )
    await update_settings({
        TITLE_KEY: "" if title == DEFAULT_TITLE_TEMPLATE else title,
        DESCRIPTION_KEY: "" if description == DEFAULT_DESCRIPTION_TEMPLATE else description,
    })
    return await get_template()
