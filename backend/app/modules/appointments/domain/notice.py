"""Los avisos de cita por WhatsApp: al cliente y al equipo.

Cada negocio elige, para cada destinatario, una plantilla oficial aprobada
por Meta (la única forma de escribirle a alguien que no escribió en las
últimas 24 h) y qué campo de la cita va en cada variable. Antes estos avisos
los mandaba un workflow de n8n propio de un negocio; vivir acá los vuelve
iguales para todos.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from enum import StrEnum

from app.core.errors import Invalid
from app.modules.appointments.domain.calendar_event import BUILTIN_FIELDS, CUSTOM_PREFIX, field_value, placeholders


class Audience(StrEnum):
    CLIENT = "client"
    STAFF = "staff"


class InvalidNotice(Invalid):
    """El aviso de cita no es válido"""

    code = "invalid_appointment_notice"


# Campos que solo existen en los avisos: la fecha y la hora dichas como las
# escribe el equipo en WhatsApp ("JUEVES 12 de Noviembre a las 01:00 Pm").
FORMATTED_FIELDS: dict[str, str] = {
    "fecha_larga": "Fecha larga (JUEVES 12 de Noviembre)",
    "hora_12h": "Hora (01:00 Pm)",
    "hora_fin": "Hora de fin",
    "horario": "Horario (de 09:00 a 11:00)",
    "fecha_horario": "Fecha y horario (12/11/2026 de 09:00 a 11:00)",
}

# Meta rechaza una variable vacía; un dato opcional que no se llenó (el DNI,
# el detalle) sale así en vez de frenar el aviso entero.
EMPTY_VALUE = "-"

_WEEKDAYS = ("LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO", "DOMINGO")
_MONTHS = (
    "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
    "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
)
_HOUR = re.compile(r"^(\d{1,2}):(\d{2})")


@dataclass(frozen=True)
class NoticeConfig:
    enabled: bool = False
    template_id: int | None = None
    parameters: tuple[str, ...] = field(default_factory=tuple)

    @classmethod
    def from_settings(cls, enabled: str, template_id: str, parameters: str) -> "NoticeConfig":
        """Lo guardado en los ajustes del negocio. Un valor ilegible cuenta
        como "sin configurar": mejor no avisar que avisar mal."""
        try:
            parsed_id = int(template_id) if template_id.strip() else None
        except ValueError:
            parsed_id = None
        try:
            keys = json.loads(parameters) if parameters.strip() else []
        except ValueError:
            keys = []
        if not isinstance(keys, list) or not all(isinstance(key, str) for key in keys):
            keys = []
        return cls(enabled=enabled == "true", template_id=parsed_id, parameters=tuple(keys))

    def to_settings(self) -> dict[str, str]:
        return {
            "enabled": "true" if self.enabled else "",
            "template_id": "" if self.template_id is None else str(self.template_id),
            "parameters": json.dumps(list(self.parameters)) if self.parameters else "",
        }


LEAD_PREFIX = "lead."
LEAD_CUSTOM_PREFIX = "lead.custom."
# Datos del lead de la cita: el cliente puede tener un nombre distinto en el
# chat que en la cita, o datos que solo viven en su ficha.
LEAD_FIELDS: dict[str, str] = {
    "lead.nombre": "Nombre en el CRM",
    "lead.telefono": "WhatsApp",
    "lead.telefono_secundario": "Teléfono secundario",
    "lead.servicio_interes": "Servicio de interés",
    "lead.vendedor": "Vendedor asignado",
    "lead.origen": "Origen",
}

_KEY = re.compile(r"[a-z0-9_.]+")
_MAX_PARAMETER_LENGTH = 300


def as_template(value: str) -> str:
    """Cada variable se guarda como un texto con marcadores ``{campo}``.
    Antes se guardaba solo la clave del campo: ``fecha`` equivale a
    ``{fecha}``."""
    value = value.strip()
    if _KEY.fullmatch(value) and (
        value in BUILTIN_FIELDS or value in FORMATTED_FIELDS
        or value.startswith(CUSTOM_PREFIX) or value.startswith(LEAD_PREFIX)
    ):
        return f"{{{value}}}"
    return value


def validate_parameters(templates: list[str], *, expected: int, known_keys: set[str]) -> tuple[str, ...]:
    """Cada variable de la plantilla necesita su contenido, y cada campo que
    nombra tiene que existir: uno inventado saldría siempre vacío."""
    if len(templates) != expected:
        raise InvalidNotice(f"La plantilla tiene {expected} variable(s) y se armaron {len(templates)}")
    clean = []
    for position, raw in enumerate(templates, start=1):
        template = " ".join(as_template(raw).split())
        if not template:
            raise InvalidNotice(f"La variable {{{{{position}}}}} está vacía")
        if len(template) > _MAX_PARAMETER_LENGTH:
            raise InvalidNotice(f"La variable {{{{{position}}}}} supera los {_MAX_PARAMETER_LENGTH} caracteres")
        unknown = [key for key in placeholders(template) if key not in known_keys]
        if unknown:
            raise InvalidNotice(f"El campo {{{unknown[0]}}} no existe")
        clean.append(template)
    return tuple(clean)


def _lead_text(value: object) -> str:
    if value is None or value is False:
        return ""
    if value is True:
        return "Sí"
    if isinstance(value, list):
        return ", ".join(_lead_text(item) for item in value if _lead_text(item))
    return str(value).strip()


def field_values(appointment: dict, lead: dict | None) -> dict[str, str]:
    """Todo lo que puede ir en un aviso, por clave, ya como texto."""
    values = {key: field_value(appointment, key) for key in BUILTIN_FIELDS}
    values["fecha"] = _short_date(appointment)
    values.update({key: _formatted(appointment, key) for key in FORMATTED_FIELDS})
    for key in (appointment.get("custom_fields") or {}):
        values[f"{CUSTOM_PREFIX}{key}"] = field_value(appointment, f"{CUSTOM_PREFIX}{key}")
    lead = lead or {}
    for key in LEAD_FIELDS:
        values[key] = _lead_text(lead.get(key.removeprefix(LEAD_PREFIX)))
    for key, value in (lead.get("custom_fields") or {}).items():
        values[f"{LEAD_CUSTOM_PREFIX}{key}"] = _lead_text(value)
    return values


def render_parameter(template: str, values: dict[str, str]) -> str:
    """El texto de una variable. WhatsApp no acepta saltos de línea ni
    espacios repetidos dentro de una variable (error 132018), y tampoco una
    variable vacía: si todos sus campos quedaron vacíos sale "-"."""
    keys = placeholders(template)
    if keys and not any(values.get(key) for key in keys):
        return EMPTY_VALUE
    rendered = _PLACEHOLDER.sub(lambda match: values.get(match.group(1), ""), template)
    return " ".join(rendered.split()) or EMPTY_VALUE


_PLACEHOLDER = re.compile(r"\{([a-z0-9_.]+)\}")


def _start(appointment: dict) -> tuple[int, int] | None:
    match = _HOUR.match(str(appointment.get("hora") or "").strip())
    if not match:
        return None
    return int(match.group(1)), int(match.group(2))


def _end(appointment: dict) -> str:
    start = _start(appointment)
    minutes = int(appointment.get("duration_minutes") or 0)
    if start is None or minutes <= 0:
        return ""
    ends = datetime(2000, 1, 1, *start) + timedelta(minutes=minutes)
    return ends.strftime("%H:%M")


def _formatted(appointment: dict, key: str) -> str:
    start = _start(appointment)
    if key == "fecha_larga":
        try:
            day = date.fromisoformat(str(appointment.get("fecha") or ""))
        except ValueError:
            return ""
        return f"{_WEEKDAYS[day.weekday()]} {day.day} de {_MONTHS[day.month - 1]}"
    if key == "hora_12h":
        if start is None:
            return ""
        hour, minute = start
        suffix = "Am" if hour < 12 else "Pm"
        return f"{(hour % 12) or 12:02d}:{minute:02d} {suffix}"
    if key == "hora_fin":
        return _end(appointment)
    if key == "horario":
        if start is None:
            return ""
        begins = f"{start[0]:02d}:{start[1]:02d}"
        ends = _end(appointment)
        return f"de {begins} a {ends}" if ends else begins
    if key == "fecha_horario":
        # Una sola variable para "Cita: ...": Meta no acepta dos variables
        # pegadas, así que la plantilla del equipo las pide juntas.
        return " ".join(part for part in (_short_date(appointment), _formatted(appointment, "horario")) if part)
    return ""


def _short_date(appointment: dict) -> str:
    try:
        return date.fromisoformat(str(appointment.get("fecha") or "")).strftime("%d/%m/%Y")
    except ValueError:
        return ""


def parameter_values(appointment: dict, templates: tuple[str, ...], lead: dict | None = None) -> list[str]:
    """El valor de cada variable para esta cita (y su lead)."""
    values = field_values(appointment, lead)
    return [render_parameter(as_template(template), values) for template in templates]


# Las variables de una plantilla se arman con la sintaxis de los mensajes
# ({{nombre}}, {{cita.fecha}}); el aviso usa la del armador ({lead.nombre},
# {fecha}). Así el aviso arranca con lo que ya se definió en Plantillas.
_TEMPLATE_LEAD_VARIABLES = {
    "nombre": "lead.nombre",
    "telefono": "lead.telefono",
    "servicio": "lead.servicio_interes",
    "vendedor": "lead.vendedor",
}
_TEMPLATE_VARIABLE = re.compile(r"\{\{\s*([a-z0-9_.]+)\s*\}\}")


def from_template_parameter(value: str) -> str:
    def convert(match: re.Match) -> str:
        name = match.group(1)
        if name.startswith("cita."):
            return f"{{{name.removeprefix('cita.')}}}"
        if name in _TEMPLATE_LEAD_VARIABLES:
            return f"{{{_TEMPLATE_LEAD_VARIABLES[name]}}}"
        return match.group(0)

    return _TEMPLATE_VARIABLE.sub(convert, str(value)).strip()
