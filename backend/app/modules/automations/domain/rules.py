"""Reglas de las automatizaciones que no tocan base de datos, red ni reloj:
variables de los textos, horario laboral y condiciones sobre el lead.

Lo que necesita I/O (la ventana de WhatsApp, si un vendedor existe, mandar un
mensaje) vive en ``application`` y llega por puertos.
"""

import re
import unicodedata
from datetime import date, datetime, time, timedelta, timezone, tzinfo
from functools import lru_cache
from zoneinfo import ZoneInfo

from app.modules.leads.ports.types import LEAD_STAGE_KEY_PATTERN

BUSINESS_TIMEZONE_KEY = "America/Lima"
BUSINESS_START_HOUR = 8
BUSINESS_END_HOUR = 18
CRM_VARIABLES = {"nombre", "telefono", "servicio", "vendedor", "fecha_actual"}
MAX_COOLDOWN_MINUTES = 43200

_VARIABLE_PATTERN = re.compile(r"\{\{(\w+)\}\}")


@lru_cache(maxsize=1)
def business_timezone() -> tzinfo:
    """Se resuelve al primer uso y no al importar: en Windows sin el paquete
    tzdata, hacerlo a nivel de módulo revienta el arranque entero."""
    return ZoneInfo(BUSINESS_TIMEZONE_KEY)


def local_day_range_utc(date_from: date, date_to: date) -> tuple[datetime, datetime]:
    """Convierte un rango de fechas de calendario (en la timezone de negocio)
    a límites UTC medio-abiertos [inicio, fin) listos para filtrar columnas
    datetime en UTC, p. ej. `automation_executions.created_at`."""
    tz = business_timezone()
    start = datetime.combine(date_from, time.min, tzinfo=tz).astimezone(timezone.utc)
    end = datetime.combine(date_to + timedelta(days=1), time.min, tzinfo=tz).astimezone(timezone.utc)
    return start, end


def render_variables(value: str, chat: dict, now: datetime | None = None) -> str:
    """Reemplaza {{variable}} por los datos del lead. Las variables
    desconocidas se dejan intactas para que el texto no pierda información."""
    local_now = now or datetime.now(business_timezone())
    values = {
        "nombre": chat.get("name") or "",
        "telefono": chat.get("phone") or "",
        "servicio": chat.get("servicio_interes") or "",
        "vendedor": chat.get("vendedor") or "",
        "fecha_actual": local_now.strftime("%d/%m/%Y"),
    }
    return _VARIABLE_PATTERN.sub(lambda match: values.get(match.group(1), match.group(0)), value)


def unknown_variables(value: str) -> set[str]:
    return set(_VARIABLE_PATTERN.findall(value)) - CRM_VARIABLES


def is_business_hours(now: datetime) -> bool:
    return now.weekday() < 5 and BUSINESS_START_HOUR <= now.hour < BUSINESS_END_HOUR


def normalize_conditions(raw_conditions: object) -> dict:
    conditions = raw_conditions if isinstance(raw_conditions, dict) else {}
    normalized = {
        "stage": str(conditions.get("stage") or "").strip() or None,
        "origin_contains": str(conditions.get("origin_contains") or "").strip()[:120] or None,
        "service_contains": str(conditions.get("service_contains") or "").strip()[:120] or None,
        "seller_id": int(conditions["seller_id"]) if conditions.get("seller_id") else None,
        "tag_id": int(conditions["tag_id"]) if conditions.get("tag_id") else None,
        "require_open_window": bool(conditions.get("require_open_window", False)),
        "business_hours_only": bool(conditions.get("business_hours_only", False)),
        "cooldown_minutes": (
            max(1, min(MAX_COOLDOWN_MINUTES, int(conditions["cooldown_minutes"])))
            if conditions.get("cooldown_minutes")
            else None
        ),
    }
    # Solo la forma: las etapas son de cada negocio y su existencia se valida
    # contra la base en application.validation, que sí tiene I/O.
    if normalized["stage"] and not is_stage_key(normalized["stage"]):
        raise ValueError("Etapa de condición inválida")
    return normalized


_STAGE_KEY = re.compile(LEAD_STAGE_KEY_PATTERN)


def is_stage_key(value: object) -> bool:
    """¿Tiene forma de clave de etapa? (no dice si el negocio la tiene)."""
    return isinstance(value, str) and _STAGE_KEY.fullmatch(value) is not None


def matches_static_conditions(conditions: dict, chat: dict) -> tuple[bool, str | None]:
    """Condiciones que se resuelven solo con los datos del lead ya cargados.
    Las que requieren consultar la base (cooldown, ventana de WhatsApp) las
    evalúa la aplicación antes de delegar acá."""
    if conditions.get("stage") and chat.get("stage") != conditions["stage"]:
        return False, "La etapa no coincide"
    if conditions.get("origin_contains") and conditions["origin_contains"].lower() not in (chat.get("origen") or "").lower():
        return False, "El origen no coincide"
    if conditions.get("service_contains") and conditions["service_contains"].lower() not in (chat.get("servicio_interes") or "").lower():
        return False, "El servicio no coincide"
    if conditions.get("seller_id") and chat.get("vendedor_id") != conditions["seller_id"]:
        return False, "El vendedor no coincide"
    if conditions.get("tag_id") and conditions["tag_id"] not in {tag["id"] for tag in chat.get("tags", [])}:
        return False, "La etiqueta no está asignada"
    return True, None


FLOW_COORDINATE_LIMIT = 1_000_000


def _normalize_flow_coordinate(value: object) -> int:
    try:
        coordinate = int(value or 0)
    except (TypeError, ValueError, OverflowError):
        coordinate = 0
    return max(-FLOW_COORDINATE_LIMIT, min(FLOW_COORDINATE_LIMIT, coordinate))


def normalize_flow_position(value: object) -> dict:
    """Conserva la posición del lienzo en un rango prácticamente infinito.

    El límite evita valores no representables o coordenadas absurdas que
    degraden el navegador, pero permite más de dos millones de unidades en
    cada eje y trabajar también a la izquierda/arriba del origen.
    """
    position = value if isinstance(value, dict) else {}
    return {
        "x": _normalize_flow_coordinate(position.get("x")),
        "y": _normalize_flow_coordinate(position.get("y")),
    }


def normalize_reply_text(value: str) -> str:
    """Trim, espacios estables, minúsculas y sin acentos para comparar texto
    de cliente sin depender de presentación, mayúsculas o tildes."""
    compact = " ".join(value.strip().lower().split())
    decomposed = unicodedata.normalize("NFKD", compact)
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def wait_seconds(data: dict) -> int:
    """Segundos de espera de un nodo Wait. Con compatibilidad hacia atrás:
    los flujos publicados antes de dividir la espera en horas/minutos/
    segundos solo tienen "minutes" en su `flow_definition` guardada, y esa
    definición vieja no se reescribe sola — solo al volver a publicar."""
    seconds = data.get("seconds")
    if seconds is not None:
        return int(seconds)
    return int(data.get("minutes") or 0) * 60


def message_sent_at(value: object, *, fallback: datetime) -> datetime:
    """Normaliza el timestamp que llega desde el webhook o el watcher.

    Los mensajes consultados desde la base ya incluyen ``sent_at``. El fallback
    conserva compatibilidad con productores antiguos durante un despliegue
    gradual, aunque los eventos nuevos siempre deberían traerlo.
    """
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str) and value.strip():
        try:
            parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        except ValueError:
            parsed = fallback
    else:
        parsed = fallback
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)
