"""Qué dice el evento de Google Calendar de una cita.

Cada negocio arma el título y la descripción con los campos de la cita. Se
guardan como texto con marcadores ``{campo}``: el texto libre queda tal cual y
cada marcador se reemplaza por el valor de la cita. Los campos personalizados
se nombran ``{custom.<key>}`` y ``{campos_personalizados}`` los lista todos,
uno por línea, como hacía el evento antes de que existiera la plantilla.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from app.core.errors import Invalid

CUSTOM_PREFIX = "custom."
ALL_CUSTOM_FIELDS = "campos_personalizados"

# Campos fijos de la cita, en el orden en que los ofrece el editor.
BUILTIN_FIELDS: dict[str, str] = {
    "tratamiento": "Servicio",
    "nombre_completo": "Contacto",
    "telefono": "Teléfono",
    "dni": "DNI",
    "vendedor": "Responsable",
    "detalle": "Detalle",
    "fecha": "Fecha",
    "hora": "Hora",
    "duration_minutes": "Duración (min)",
    "adelanto": "Adelanto",
}

# Lo mismo que mostraba el evento antes de la plantilla: un negocio que nunca
# la tocó no ve ningún cambio en su calendario.
DEFAULT_TITLE_TEMPLATE = "{tratamiento}"
DEFAULT_DESCRIPTION_TEMPLATE = "\n".join((
    "{detalle}",
    "Contacto: {nombre_completo}",
    "Teléfono: {telefono}",
    "Responsable: {vendedor}",
    "{campos_personalizados}",
))

# Google corta el título largo en la grilla y acepta hasta 8 KB de
# descripción; los topes dejan margen y frenan una plantilla pegada por error.
MAX_TITLE_LENGTH = 200
MAX_DESCRIPTION_LENGTH = 2000

_PLACEHOLDER = re.compile(r"\{([a-z0-9_.]+)\}")


@dataclass(frozen=True)
class EventContent:
    title: str
    description: str


class InvalidEventTemplate(Invalid):
    """La plantilla del evento no es válida"""

    code = "invalid_event_template"


def placeholders(template: str) -> list[str]:
    return _PLACEHOLDER.findall(template)


def validate_template(template: str, *, max_length: int, custom_keys: set[str] | None = None) -> str:
    """La plantilla tal como se guarda. Un campo desconocido es un error: se
    vería como texto ``{algo}`` en todos los eventos sin que nadie lo note.
    Sin ``custom_keys`` no se revisan los campos personalizados."""
    clean = template.replace("\r\n", "\n").strip()
    if len(clean) > max_length:
        raise InvalidEventTemplate(f"La plantilla supera los {max_length} caracteres")
    for key in placeholders(clean):
        if key in BUILTIN_FIELDS or key == ALL_CUSTOM_FIELDS:
            continue
        if key.startswith(CUSTOM_PREFIX) and (
            custom_keys is None or key.removeprefix(CUSTOM_PREFIX) in custom_keys
        ):
            continue
        raise InvalidEventTemplate(f"El campo {{{key}}} no existe")
    return clean


def _text(value: Any) -> str:
    if value is None or value is False:
        return ""
    if value is True:
        return "Sí"
    if isinstance(value, float) and value.is_integer():
        value = int(value)
    if isinstance(value, list):
        return ", ".join(_text(item) for item in value if _text(item))
    return str(value).strip()


def _value(appointment: dict, key: str) -> str:
    custom = appointment.get("custom_fields") or {}
    if key.startswith(CUSTOM_PREFIX):
        return _text(custom.get(key.removeprefix(CUSTOM_PREFIX)))
    value = appointment.get(key)
    # Un adelanto en 0 es "no dejó adelanto", no un dato que valga mostrar.
    if key == "adelanto" and not value:
        return ""
    return _text(value)


def _custom_lines(appointment: dict, field_labels: dict[str, str]) -> list[str]:
    return [
        f"{field_labels.get(key, key)}: {_text(value)}"
        for key, value in (appointment.get("custom_fields") or {}).items()
        if _text(value)
    ]


def _render_line(line: str, appointment: dict) -> str | None:
    """La línea con sus valores, o None si todos sus campos quedaron vacíos:
    así "Teléfono: " no aparece en una cita sin teléfono."""
    keys = placeholders(line)
    values = {key: _value(appointment, key) for key in keys}
    if keys and not any(values.values()):
        return None
    return _PLACEHOLDER.sub(lambda match: values[match.group(1)], line).strip()


def render_event(
    appointment: dict,
    field_labels: dict[str, str],
    *,
    title_template: str = "",
    description_template: str = "",
) -> EventContent:
    """Título y descripción del evento. Una plantilla vacía vale la de
    siempre; un título que queda vacío cae al servicio, porque Google muestra
    un evento sin título como "(Sin título)"."""
    title = _render_line(" ".join((title_template or DEFAULT_TITLE_TEMPLATE).split()), appointment)
    if not title:
        title = _text(appointment.get("tratamiento")) or "Cita"

    lines: list[str] = []
    for line in (description_template or DEFAULT_DESCRIPTION_TEMPLATE).split("\n"):
        if line.strip() == f"{{{ALL_CUSTOM_FIELDS}}}":
            lines.extend(_custom_lines(appointment, field_labels))
            continue
        if ALL_CUSTOM_FIELDS in placeholders(line):
            line = line.replace(f"{{{ALL_CUSTOM_FIELDS}}}", ", ".join(_custom_lines(appointment, field_labels)))
        rendered = _render_line(line, appointment)
        if rendered is not None:
            lines.append(rendered)
    # Las líneas en blanco que el negocio puso como separador se respetan,
    # pero no al principio ni al final, ni dos seguidas.
    compact: list[str] = []
    for line in lines:
        if not line and (not compact or not compact[-1]):
            continue
        compact.append(line)
    while compact and not compact[-1]:
        compact.pop()
    return EventContent(title=title[:MAX_TITLE_LENGTH], description="\n".join(compact))
