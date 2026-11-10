"""Moneda del negocio para los importes del dashboard (adelantos)."""

import re

from app.modules.ai.public import business_currency as _profile_currency

# El perfil IA acepta texto libre en la moneda ("S/", "soles"); solo un código
# ISO 4217 sirve para formatear importes en el navegador.
_ISO_CURRENCY = re.compile(r"^[A-Z]{3}$")


async def business_currency() -> str | None:
    value = await _profile_currency()
    return value if value and _ISO_CURRENCY.match(value) else None
