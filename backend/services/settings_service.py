from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as pg_insert

from config import settings as env_settings
from db.models import AppSetting
from db.session import get_sessionmaker


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


async def _db_values() -> dict[str, str | None]:
    async with get_sessionmaker()() as session:
        rows = (await session.execute(select(AppSetting.key, AppSetting.value))).all()
    return {key: value for key, value in rows}


def _env_default(key: str) -> str:
    return getattr(env_settings, key, "") or ""


async def get_effective(key: str) -> str:
    """Valor a usar en runtime: el guardado en DB si no está vacío, si no el
    de la variable de entorno (permite que .env siga funcionando como
    "semilla" hasta que se cargue algo distinto desde la UI)."""
    async with get_sessionmaker()() as session:
        row = (
            await session.execute(select(AppSetting.value).where(AppSetting.key == key))
        ).scalar_one_or_none()
    return row if row else _env_default(key)


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
            stmt = (
                pg_insert(AppSetting)
                .values(key=key, value=value)
                .on_conflict_do_update(index_elements=[AppSetting.key], set_={"value": value})
            )
            await session.execute(stmt)
        await session.commit()
