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
