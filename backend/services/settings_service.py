import asyncio
from collections.abc import Iterable
from dataclasses import dataclass
from time import monotonic

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from config import settings as env_settings
from db.models import AppSetting
from db.session import get_sessionmaker
from services.secret_cipher import decrypt_secret, encrypt_secret, needs_reencryption


@dataclass(frozen=True)
class SettingDef:
    key: str
    label: str
    group: str
    group_label: str
    secret: bool


# Fuente de verdad de qué keys son editables desde la app. Agregar una nueva
# integración (ej. otro proveedor de TTS, otra API) es sumar una entrada acá
# — el resto (endpoint, UI) las recorre genéricamente.
SETTING_DEFS: list[SettingDef] = [
    SettingDef("n8n_webhook_url", "URL del webhook", "n8n", "n8n (sugerencias IA)", secret=False),
    SettingDef("n8n_webhook_token", "Token de autenticación", "n8n", "n8n (sugerencias IA)", secret=True),
    SettingDef(
        "inbound_webhook_token",
        "Token entrante (n8n → app)",
        "n8n",
        "n8n (sugerencias IA)",
        secret=True,
    ),
    SettingDef("evolution_api_url", "URL de la API", "evolution", "Evolution API (WhatsApp)", secret=False),
    SettingDef("evolution_api_key", "API key", "evolution", "Evolution API (WhatsApp)", secret=True),
    SettingDef("evolution_instance", "Nombre de instancia", "evolution", "Evolution API (WhatsApp)", secret=False),
    SettingDef("elevenlabs_api_key", "API key", "elevenlabs", "ElevenLabs (texto a voz)", secret=True),
    SettingDef("elevenlabs_voice_id", "ID de voz", "elevenlabs", "ElevenLabs (texto a voz)", secret=False),
    SettingDef("elevenlabs_model_id", "Modelo", "elevenlabs", "ElevenLabs (texto a voz)", secret=False),
    SettingDef("elevenlabs_stability", "Estabilidad (0-1)", "elevenlabs", "ElevenLabs (texto a voz)", secret=False),
    SettingDef("elevenlabs_style", "Estilo (0-1)", "elevenlabs", "ElevenLabs (texto a voz)", secret=False),
    SettingDef("elevenlabs_speed", "Velocidad (0.7-1.2)", "elevenlabs", "ElevenLabs (texto a voz)", secret=False),
    SettingDef(
        "elevenlabs_use_speaker_boost",
        "Speaker boost (true/false)",
        "elevenlabs",
        "ElevenLabs (texto a voz)",
        secret=False,
    ),
]
_DEFS_BY_KEY = {d.key: d for d in SETTING_DEFS}
SETTINGS_CACHE_TTL_SECONDS = 30.0
_effective_cache: dict[str, str] | None = None
_effective_cache_expires_at = 0.0
_effective_cache_lock = asyncio.Lock()


async def _raw_db_values() -> dict[str, str | None]:
    async with get_sessionmaker()() as session:
        rows = (await session.execute(select(AppSetting.key, AppSetting.value))).all()
    return {key: value for key, value in rows}


async def _db_values() -> dict[str, str | None]:
    raw = await _raw_db_values()
    return {
        key: decrypt_secret(key, value) if value else value
        for key, value in raw.items()
    }


def _env_default(key: str) -> str:
    return getattr(env_settings, key, "") or ""


def invalidate_settings_cache() -> None:
    global _effective_cache, _effective_cache_expires_at
    _effective_cache = None
    _effective_cache_expires_at = 0.0


async def _effective_values() -> dict[str, str]:
    global _effective_cache, _effective_cache_expires_at
    now = monotonic()
    if _effective_cache is not None and now < _effective_cache_expires_at:
        return _effective_cache

    async with _effective_cache_lock:
        now = monotonic()
        if _effective_cache is not None and now < _effective_cache_expires_at:
            return _effective_cache
        db_values = await _db_values()
        _effective_cache = {
            key: db_values.get(key) or _env_default(key)
            for key in _DEFS_BY_KEY
        }
        _effective_cache_expires_at = monotonic() + SETTINGS_CACHE_TTL_SECONDS
        return _effective_cache


async def get_effective_many(keys: Iterable[str]) -> dict[str, str]:
    """Resuelve varias claves con una sola carga de DB y una caché corta.

    La invalidación local hace inmediatos los cambios; el TTL evita valores
    obsoletos entre procesos cuando el despliegue usa más de un worker.
    """
    requested = tuple(keys)
    values = await _effective_values()
    return {key: values.get(key, _env_default(key)) for key in requested}


async def get_effective(key: str) -> str:
    return (await get_effective_many((key,)))[key]


async def list_settings() -> list[dict]:
    db_values = await _db_values()
    items = []
    for d in SETTING_DEFS:
        db_value = db_values.get(d.key)
        effective = db_value if db_value else _env_default(d.key)
        items.append(
            {
                "key": d.key,
                "label": d.label,
                "group": d.group,
                "group_label": d.group_label,
                "secret": d.secret,
                "configured": bool(effective),
                # Los valores secretos nunca viajan al navegador ya guardados;
                # solo se pueden sobrescribir, no releer.
                "value": None if d.secret else effective,
            }
        )
    return items


async def update_settings(values: dict[str, str]) -> None:
    unknown = set(values) - set(_DEFS_BY_KEY)
    if unknown:
        raise ValueError(f"Configuración desconocida: {', '.join(sorted(unknown))}")

    async with get_sessionmaker()() as session:
        for key, value in values.items():
            stored_value = encrypt_secret(key, value) if value else None
            stmt = (
                pg_insert(AppSetting)
                .values(key=key, value=stored_value)
                .on_conflict_do_update(index_elements=[AppSetting.key], set_={"value": stored_value})
            )
            await session.execute(stmt)
        await session.commit()
    async with _effective_cache_lock:
        invalidate_settings_cache()


async def migrate_settings_encryption() -> int:
    """Cifra filas históricas y rota las hechas con la clave de compatibilidad.

    Es idempotente. Un ciphertext corrupto o una clave incorrecta detienen el
    arranque para evitar sobrescribir secretos que ya no puedan recuperarse.
    """
    raw = await _raw_db_values()
    replacements: dict[str, str] = {}
    for key, value in raw.items():
        if not value or not needs_reencryption(key, value):
            continue
        plaintext = decrypt_secret(key, value)
        replacements[key] = encrypt_secret(key, plaintext)

    if not replacements:
        return 0
    async with get_sessionmaker()() as session:
        for key, value in replacements.items():
            await session.execute(
                update(AppSetting).where(AppSetting.key == key).values(value=value)
            )
        await session.commit()
    async with _effective_cache_lock:
        invalidate_settings_cache()
    return len(replacements)
