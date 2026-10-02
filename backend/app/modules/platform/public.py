"""Configuración del plano de control consumida por otros dominios."""

from collections.abc import Iterable
import re

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
