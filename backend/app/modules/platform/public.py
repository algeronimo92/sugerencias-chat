"""Configuración del plano de control consumida por otros dominios."""

from collections.abc import Iterable
from datetime import tzinfo
import re
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.core.phone_utils import FALLBACK_COUNTRY_CODE
from app.modules.platform import platform_settings
from app.modules.platform.settings_service import get_effective


async def effective_country_code() -> str:
    value = re.sub(r"\D", "", await get_effective("default_country_code"))
    return value or FALLBACK_COUNTRY_CODE


async def platform_setting(key: str) -> str:
    return await platform_settings.platform_setting(key)


async def platform_settings_many(keys: Iterable[str]) -> dict[str, str]:
    return await platform_settings.platform_settings_many(keys)


DEFAULT_BUSINESS_TIMEZONE = "America/Lima"


async def business_timezone() -> tzinfo:
    """Zona en que el negocio escribe fechas y horas (la misma de Google
    Calendar). Una inválida cae a la de por defecto en vez de fallar."""
    name = (await get_effective("business_timezone")).strip() or DEFAULT_BUSINESS_TIMEZONE
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_BUSINESS_TIMEZONE)
