"""Normalización de teléfonos de leads a E.164.

Única fuente de verdad backend. frontend/src/utils/phone.ts es espejo de estas
reglas y mensajes: cualquier cambio acá debe replicarse allá.
"""

import re

from services.settings_service import get_effective

FALLBACK_COUNTRY_CODE = "51"

_E164_DIGITS = re.compile(r"[1-9]\d{7,14}")

# Formato local por código de país. Perú: celulares de 9 dígitos que empiezan
# con 9, o fijos de 8 dígitos (área 1 = Lima, o 2 dígitos 41-87 = provincias).
# Sin regla para un código, aplica solo el largo genérico E.164.
LOCAL_RULES: dict[str, tuple[re.Pattern[str], str]] = {
    "51": (
        re.compile(r"9\d{8}|[14-8]\d{7}"),
        "Revisá el número: en Perú los celulares tienen 9 dígitos (empiezan con 9) y los fijos 8",
    ),
}


class PhoneValidationError(ValueError):
    pass


def normalize_phone(raw: str, default_country_code: str) -> str:
    """Devuelve el número en E.164 como solo dígitos (sin ``+``).

    Un número "trae código de país" si empieza con ``+`` o si sus dígitos ya
    empiezan con el código configurado y alcanzan un largo internacional
    (código + 8). Si no lo trae, se antepone el código por defecto.
    """
    stripped = raw.strip()
    if not stripped:
        raise PhoneValidationError("El teléfono es obligatorio")
    if re.search(r"[A-Za-z]", stripped):
        raise PhoneValidationError("El teléfono no puede contener letras")

    digits = re.sub(r"\D", "", stripped)
    if not digits:
        raise PhoneValidationError("El teléfono es obligatorio")

    cc = re.sub(r"\D", "", default_country_code) or FALLBACK_COUNTRY_CODE
    has_country_code = stripped.startswith("+") or (
        digits.startswith(cc) and len(digits) >= len(cc) + 8
    )
    if has_country_code:
        # Solo se conoce la parte local si el código es el configurado; para
        # otros países (+54…) aplica únicamente el largo genérico E.164.
        local = digits[len(cc):] if digits.startswith(cc) else None
    else:
        # El "0" inicial es el prefijo nacional ("01 234 5678"): no forma
        # parte del número internacional.
        local = digits.removeprefix("0")
        digits = cc + local

    rule = LOCAL_RULES.get(cc)
    if rule and local is not None:
        pattern, message = rule
        if not pattern.fullmatch(local):
            raise PhoneValidationError(message)

    if not _E164_DIGITS.fullmatch(digits):
        raise PhoneValidationError("Revisá el número: debe tener entre 8 y 15 dígitos")
    return digits


async def effective_country_code() -> str:
    value = re.sub(r"\D", "", await get_effective("default_country_code"))
    return value or FALLBACK_COUNTRY_CODE


def digits_to_jid(digits: str) -> str:
    return f"{digits}@s.whatsapp.net"


def jid_to_digits(jid: str) -> str:
    return re.sub(r"\D", "", jid.split("@", 1)[0])
