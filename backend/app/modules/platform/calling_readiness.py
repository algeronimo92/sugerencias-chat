"""Si el número del negocio puede activar las llamadas de WhatsApp.

Meta pone dos condiciones al número (docs/analisis/17-plan-llamadas-whatsapp.md,
§2): que funcione solo por la API, no también en la app de WhatsApp Business,
y que la cuenta tenga un límite de mensajería de al menos 2000. Acá se decide
el estado a partir de lo que Meta informó; consultarlo es del adaptador.
"""

from __future__ import annotations

import re
from typing import Any

MINIMUM_MESSAGING_LIMIT = 2000

_TIER_RE = re.compile(r"^TIER_(\d+)(K|M)?$")
_MULTIPLIERS = {None: 1, "K": 1_000, "M": 1_000_000}


def messaging_limit_allows_calls(tier: str | None) -> bool | None:
    """``None`` cuando el nivel no dice un número (``TIER_NO_ACCESS``, o uno
    que Meta agregue mañana): no se da por cumplido ni por incumplido.

    Se lee el número del nombre en vez de listar los niveles: Meta sumó
    niveles intermedios más de una vez y una lista se quedaría atrás.
    """
    if not tier:
        return None
    if tier == "TIER_UNLIMITED":
        return True
    match = _TIER_RE.match(tier)
    if match is None:
        return None
    return int(match.group(1)) * _MULTIPLIERS[match.group(2)] >= MINIMUM_MESSAGING_LIMIT


def calling_readiness(requirements: dict[str, Any] | None) -> dict[str, Any]:
    """``requirements`` es lo que devolvió Meta, o ``None`` si WhatsApp no
    está conectado.

    El orden importa: la coexistencia va primero porque es lo que más cuesta
    resolver (mudar el número) y lo que la persona tiene que saber antes que
    cualquier otro requisito.
    """
    if requirements is None:
        return _readiness("not_connected")
    on_business_app = requirements.get("on_business_app")
    limit = requirements.get("messaging_limit")
    limit_ok = messaging_limit_allows_calls(limit)
    if on_business_app is True:
        state = "requires_migration"
    elif limit_ok is False:
        state = "limit_too_low"
    elif on_business_app is None or limit_ok is None:
        state = "unverified"
    else:
        state = "ready"
    return _readiness(state, on_business_app=on_business_app, messaging_limit=limit, messaging_limit_ok=limit_ok)


def _readiness(
    state: str, *, on_business_app: bool | None = None,
    messaging_limit: str | None = None, messaging_limit_ok: bool | None = None,
) -> dict[str, Any]:
    return {
        "state": state,
        "on_business_app": on_business_app,
        "messaging_limit": messaging_limit,
        "messaging_limit_ok": messaging_limit_ok,
    }


DAYS = ("MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY")
_TIME_RE = re.compile(r"^([01]\d|2[0-3])[0-5]\d$")


class InvalidCallHours(ValueError):
    pass


def calling_from_meta(calling: dict[str, Any]) -> dict[str, Any]:
    """Lo que la pantalla necesita de la configuración de Meta: si están
    activas y el horario semanal. Lo demás (SIP, buzón) no se usa."""
    hours = calling.get("call_hours") if isinstance(calling.get("call_hours"), dict) else {}
    slots = [
        {"day": slot.get("day_of_week"), "open": slot.get("open_time"), "close": slot.get("close_time")}
        for slot in hours.get("weekly_operating_hours") or []
        if isinstance(slot, dict) and slot.get("day_of_week") in DAYS
    ]
    return {
        "enabled": calling.get("status") == "ENABLED",
        "hours_enabled": hours.get("status") == "ENABLED",
        "hours": slots,
    }


def calling_for_meta(*, enabled: bool, hours: list[dict[str, str]], timezone: str) -> dict[str, Any]:
    """El cuerpo para Meta. El botón de llamar queda visible para todos los
    clientes y quien llamó puede ser llamado de vuelta sin pedirle permiso:
    son decisiones de producto, no opciones (plan §4.7). Con las llamadas
    activas el horario es obligatorio: sin él, cada llamada fuera de hora
    queda sin atender y Meta oculta el botón por baja atención."""
    if not enabled:
        return {"status": "DISABLED"}
    if not hours:
        raise InvalidCallHours("Para activar las llamadas hay que indicar el horario de atención")
    per_day: dict[str, int] = {}
    slots = []
    for slot in hours:
        day, open_time, close_time = slot.get("day"), slot.get("open") or "", slot.get("close") or ""
        if day not in DAYS or not _TIME_RE.match(open_time) or not _TIME_RE.match(close_time) or open_time >= close_time:
            raise InvalidCallHours("El horario de llamadas no es válido")
        per_day[day] = per_day.get(day, 0) + 1
        if per_day[day] > 2:
            raise InvalidCallHours("Meta admite como máximo dos tramos por día")
        slots.append({"day_of_week": day, "open_time": open_time, "close_time": close_time})
    return {
        "status": "ENABLED",
        "call_icon_visibility": "DEFAULT",
        "callback_permission_status": "ENABLED",
        "call_hours": {"status": "ENABLED", "timezone_id": timezone, "weekly_operating_hours": slots},
    }

