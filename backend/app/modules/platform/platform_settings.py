"""Configuración global compartida por todos los tenants.

Estas claves pertenecen a la app Tech Provider y a los dos sentidos del canal
con n8n: los workflows de IA son uno solo para todos los negocios (el tenant
viaja en el token firmado de cada job, no en la URL), así que su dirección y
su token los administra la plataforma y ningún negocio los ve.
Se almacenan cifradas en ``public.platform_settings`` y nunca se buscan dentro
del schema de un negocio. El entorno queda como respaldo de despliegue.
"""

from __future__ import annotations

import asyncio
from collections.abc import Iterable
from dataclasses import dataclass
from time import monotonic

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.core.config import settings
from app.db.models.control import PlatformSetting
from app.db.session import control_session
from app.core.secret_cipher import decrypt_secret, encrypt_secret


@dataclass(frozen=True, slots=True)
class PlatformSettingDef:
    key: str
    label: str
    secret: bool


PLATFORM_SETTING_DEFS = (
    PlatformSettingDef("meta_app_id", "Facebook App ID (Tech Provider)", False),
    PlatformSettingDef("meta_config_id", "Configuration ID de Embedded Signup", False),
    PlatformSettingDef("meta_app_secret", "Facebook App Secret", True),
    PlatformSettingDef("meta_verify_token", "Verify Token del webhook de Meta", True),
    PlatformSettingDef("inbound_webhook_token", "Token entrante n8n → backend", True),
    PlatformSettingDef("n8n_webhook_url", "URL del workflow de sugerencias (n8n)", False),
    PlatformSettingDef("n8n_analyst_webhook_url", "URL del workflow analista (n8n)", False),
    PlatformSettingDef("n8n_webhook_token", "Token saliente backend → n8n", True),
)
_DEFS_BY_KEY = {definition.key: definition for definition in PLATFORM_SETTING_DEFS}
PLATFORM_KEYS = frozenset(_DEFS_BY_KEY)
_CACHE_TTL_SECONDS = 30.0
_cache: tuple[float, dict[str, str], dict[str, str]] | None = None
_cache_lock = asyncio.Lock()


def _environment_value(key: str) -> str:
    return str(getattr(settings, key, "") or "").strip()


async def _raw_database_values() -> dict[str, str | None]:
    async with control_session() as session:
        rows = (
            await session.execute(
                select(PlatformSetting.key, PlatformSetting.encrypted_value)
                .where(PlatformSetting.key.in_(PLATFORM_KEYS))
            )
        ).all()
    return {key: value for key, value in rows}


async def _legacy_single_tenant_values() -> dict[str, str]:
    """Compatibilidad durante la migración de una instalación single-tenant."""

    if settings.multitenancy_enabled:
        return {}
    from app.modules.platform.settings_service import _raw_db_values

    raw = await _raw_db_values()
    return {
        key: decrypt_secret(key, value).strip()
        for key, value in raw.items()
        if key in PLATFORM_KEYS and value
    }


async def _resolve_uncached() -> tuple[dict[str, str], dict[str, str]]:
    raw = await _raw_database_values()
    database = {
        key: decrypt_secret(key, value, namespace="platform_settings").strip()
        for key, value in raw.items()
        if value
    }
    legacy = await _legacy_single_tenant_values()
    values: dict[str, str] = {}
    sources: dict[str, str] = {}
    for key in PLATFORM_KEYS:
        environment = _environment_value(key)
        if database.get(key):
            values[key] = database[key]
            sources[key] = "platform"
        elif environment:
            values[key] = environment
            sources[key] = "environment"
        elif legacy.get(key):
            values[key] = legacy[key]
            sources[key] = "legacy"
        else:
            values[key] = ""
            sources[key] = "missing"
    return values, sources


def invalidate_platform_settings_cache() -> None:
    global _cache
    _cache = None


async def _effective() -> tuple[dict[str, str], dict[str, str]]:
    global _cache
    now = monotonic()
    if _cache is not None and now < _cache[0]:
        return _cache[1], _cache[2]
    async with _cache_lock:
        now = monotonic()
        if _cache is not None and now < _cache[0]:
            return _cache[1], _cache[2]
        values, sources = await _resolve_uncached()
        _cache = (monotonic() + _CACHE_TTL_SECONDS, values, sources)
        return values, sources


async def platform_settings_many(keys: Iterable[str]) -> dict[str, str]:
    requested = tuple(keys)
    unknown = set(requested) - PLATFORM_KEYS
    if unknown:
        raise KeyError(f"Claves que no son de plataforma: {', '.join(sorted(unknown))}")
    values, _sources = await _effective()
    return {key: values[key] for key in requested}


async def platform_setting(key: str) -> str:
    return (await platform_settings_many((key,)))[key]


async def list_platform_settings() -> list[dict]:
    values, sources = await _effective()
    return [
        {
            "key": definition.key,
            "label": definition.label,
            "secret": definition.secret,
            "configured": bool(values[definition.key]),
            "source": sources[definition.key],
            # Los secretos son write-only para el navegador.
            "value": None if definition.secret else values[definition.key],
        }
        for definition in PLATFORM_SETTING_DEFS
    ]


async def update_platform_settings(values: dict[str, str]) -> None:
    unknown = set(values) - PLATFORM_KEYS
    if unknown:
        raise ValueError(f"Configuración global desconocida: {', '.join(sorted(unknown))}")

    async with control_session() as session:
        for key, raw_value in values.items():
            value = raw_value.strip()
            stored = encrypt_secret(key, value, namespace="platform_settings") if value else None
            statement = (
                pg_insert(PlatformSetting)
                .values(key=key, encrypted_value=stored)
                .on_conflict_do_update(
                    index_elements=[PlatformSetting.key],
                    set_={"encrypted_value": stored},
                )
            )
            await session.execute(statement)
    async with _cache_lock:
        invalidate_platform_settings_cache()


async def migrate_legacy_platform_settings() -> int:
    """Mueve claves globales de ``app_settings`` en instalaciones legacy.

    No elige valores entre múltiples tenants: en multitenant las credenciales
    globales deben venir de plataforma o del entorno. Tampoco pisa una fila
    global ni una variable de entorno ya configurada.
    """

    if settings.multitenancy_enabled:
        return 0
    existing = await _raw_database_values()
    legacy = await _legacy_single_tenant_values()
    pending = {
        key: value
        for key, value in legacy.items()
        if value and not existing.get(key) and not _environment_value(key)
    }
    if not pending:
        return 0
    await update_platform_settings(pending)
    return len(pending)
