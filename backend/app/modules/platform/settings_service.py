import asyncio
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timezone
from time import monotonic
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError, available_timezones

from app.modules.platform import settings_repository
from app.core.config import settings as env_settings
from app.db.models.settings import AppSetting
from app.core.secret_cipher import (
    decrypt_secret,
    encrypt_secret,
    is_encrypted,
    needs_reencryption,
)
from app.tenancy.context import get_current_tenant
from app.db.signals import signal, tell_others_soon


@dataclass(frozen=True)
class SettingDef:
    key: str
    label: str
    group: str
    group_label: str
    secret: bool
    boolean: bool = False
    # Sigue resolviéndose (DB/env) y siendo escribible por API, pero no se
    # lista en la pestaña de configuración: es un ajuste interno que el
    # usuario final no debe tocar.
    hidden: bool = False


# Fuente de verdad de qué keys son editables desde la app. Agregar una nueva
# integración (ej. otro proveedor de TTS, otra API) es sumar una entrada acá
# — el resto (endpoint, UI) las recorre genéricamente.
#
# Los workflows de IA (sugerencias y analista) no están acá: son uno solo para
# todos los negocios y se configuran en app/modules/platform/platform_settings.py.
SETTING_DEFS: list[SettingDef] = [
    SettingDef(
        "whatsapp_active_connection",
        "Conexión activa (vacío = se detecta sola: Meta)",
        "whatsapp",
        "WhatsApp (conexión de los leads)",
        secret=False,
        hidden=True,
    ),
    SettingDef(
        "meta_access_token",
        "Token de acceso (System User, permanente)",
        "meta",
        "Meta Cloud API (WhatsApp)",
        secret=True,
    ),
    SettingDef(
        "meta_phone_number_id",
        "Phone Number ID",
        "meta",
        "Meta Cloud API (WhatsApp)",
        secret=False,
    ),
    SettingDef(
        "meta_waba_id",
        "WhatsApp Business Account ID (WABA)",
        "meta",
        "Meta Cloud API (WhatsApp)",
        secret=False,
    ),
    # Salidas que Meta solo acepta si la cuenta las tiene (ver
    # app/integrations/meta/outbound.require_capabilities).
    SettingDef(
        "meta_catalog_id",
        "Catálogo de Meta (habilita productos y catálogo)",
        "meta",
        "Meta Cloud API (WhatsApp)",
        secret=False,
    ),
    SettingDef(
        "meta_published_flow_ids",
        "Flows publicados (ids o nombres separados por coma)",
        "meta",
        "Meta Cloud API (WhatsApp)",
        secret=False,
    ),
    SettingDef(
        "meta_call_permission_enabled",
        "Pedir permiso de llamada (la cuenta tiene Calling API)",
        "meta",
        "Meta Cloud API (WhatsApp)",
        secret=False,
        boolean=True,
    ),
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
    SettingDef("default_country_code", "Código de país por defecto (sin +)", "leads", "Leads (CRM)", secret=False),
    SettingDef(
        "interactive_default_footer",
        "Pie por defecto de botones y listas de WhatsApp",
        "leads",
        "Leads (CRM)",
        secret=False,
    ),
    SettingDef(
        "auto_assign_leads_enabled",
        "Asignar leads de WhatsApp por turnos (round robin)",
        "leads",
        "Leads (CRM)",
        secret=False,
        boolean=True,
    ),
    SettingDef(
        "conversation_auto_close_hours",
        "Cerrar la conversación tras N horas sin mensajes (vacío o 0 = nunca)",
        "leads",
        "Leads (CRM)",
        secret=False,
    ),
    # El workflow de citas sí es propio de cada negocio (agenda en su
    # calendario, con sus campos), pero la URL la carga el operador desde el
    # panel de plataforma: el negocio usa la función, no la configura.
    SettingDef(
        "n8n_citas_webhook_url",
        "URL del webhook",
        "citas",
        "Citas (n8n)",
        secret=False,
        hidden=True,
    ),
    SettingDef(
        "n8n_citas_webhook_test_url",
        "URL del webhook de prueba (modo test, solo admins)",
        "citas",
        "Citas (n8n)",
        secret=False,
        hidden=True,
    ),
    SettingDef(
        "google_calendar_enabled",
        "Sincronizar citas con Google Calendar",
        "calendar",
        "Google Calendar (opcional)",
        secret=False,
        boolean=True,
    ),
    SettingDef("google_calendar_id", "ID del calendario", "calendar", "Google Calendar (opcional)", secret=False),
    SettingDef("google_calendar_client_id", "OAuth Client ID", "calendar", "Google Calendar (opcional)", secret=True),
    SettingDef("google_calendar_client_secret", "OAuth Client Secret", "calendar", "Google Calendar (opcional)", secret=True),
    SettingDef("google_calendar_refresh_token", "OAuth Refresh Token", "calendar", "Google Calendar (opcional)", secret=True),
    SettingDef("business_timezone", "Zona horaria (IANA)", "calendar", "Google Calendar (opcional)", secret=False),
]
# Ajustes por negocio que administra el operador de la plataforma y no el
# propio negocio (ver app/modules/platform/api.py).
PLATFORM_MANAGED_TENANT_KEYS = ("n8n_citas_webhook_url", "n8n_citas_webhook_test_url")
_DEFS_BY_KEY = {d.key: d for d in SETTING_DEFS}
SETTINGS_CACHE_TTL_SECONDS = 30.0
_effective_cache: dict[str | None, tuple[float, dict[str, str]]] = {}
_effective_cache_lock = asyncio.Lock()

_BUSINESS_TIMEZONE_PREFIXES = (
    "Africa/",
    "America/",
    "Antarctica/",
    "Arctic/",
    "Asia/",
    "Atlantic/",
    "Australia/",
    "Europe/",
    "Indian/",
    "Pacific/",
)


def _gmt_label(offset_seconds: int) -> str:
    sign = "+" if offset_seconds >= 0 else "-"
    total_minutes = abs(offset_seconds) // 60
    hours, minutes = divmod(total_minutes, 60)
    return f"GMT{sign}{hours:02d}:{minutes:02d}"


def list_business_timezones(now: datetime | None = None) -> list[dict]:
    """Zonas geográficas IANA que el backend realmente puede interpretar.

    Se excluyen aliases técnicos como ``Etc/GMT+5`` (su signo es invertido)
    y archivos internos de tzdata. El offset es el vigente en este momento;
    por eso refleja automáticamente horario de verano donde corresponda.
    """

    reference = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    names = {
        name
        for name in available_timezones()
        if name == "UTC" or name.startswith(_BUSINESS_TIMEZONE_PREFIXES)
    }
    items = []
    for name in names:
        local = reference.astimezone(ZoneInfo(name))
        offset = local.utcoffset()
        offset_seconds = int(offset.total_seconds()) if offset else 0
        items.append(
            {
                "id": name,
                "offset_minutes": offset_seconds // 60,
                "label": f"{name} ({_gmt_label(offset_seconds)})",
            }
        )
    return sorted(items, key=lambda item: (item["offset_minutes"], item["id"]))


def validate_business_timezone(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        return ""
    try:
        ZoneInfo(normalized)
    except ZoneInfoNotFoundError as exc:
        raise ValueError("Zona horaria IANA inválida") from exc
    if normalized != "UTC" and not normalized.startswith(_BUSINESS_TIMEZONE_PREFIXES):
        raise ValueError("Selecciona una zona horaria geográfica")
    return normalized


async def _raw_db_values() -> dict[str, str | None]:
    return await settings_repository.read_values()


async def _db_values() -> dict[str, str | None]:
    raw = await _raw_db_values()
    return {
        key: decrypt_secret(key, value) if value else value
        for key, value in raw.items()
    }


def _env_default(key: str) -> str:
    return getattr(env_settings, key, "") or ""


def _cache_scope() -> str | None:
    context = get_current_tenant()
    return str(context.organization_id) if context else None


SETTINGS_CACHE_SIGNAL = "cache:settings"


def invalidate_settings_cache(*, all_tenants: bool = False) -> None:
    """Invalida la configuración del tenant activo, en este proceso y en los
    demás (otras réplicas de la API y el worker), para que un cambio de token
    o de URL no tarde el TTL de la caché en verse.

    La caché histórica era global: durante su TTL, el segundo negocio recibía
    tokens Meta, URLs n8n y políticas del primero. Sin contexto se conserva el
    comportamiento legacy y ``all_tenants`` queda para rotaciones de plataforma.
    """
    scope = _cache_scope()
    _invalidate_here(all_tenants, scope)
    tell_others_soon(SETTINGS_CACHE_SIGNAL, {"all_tenants": all_tenants, "scope": scope})


def _invalidate_here(all_tenants: bool, scope: str | None) -> None:
    if all_tenants:
        _effective_cache.clear()
    else:
        _effective_cache.pop(scope, None)


@signal(SETTINGS_CACHE_SIGNAL).on
async def _invalidated_elsewhere(payload: dict) -> None:
    _invalidate_here(bool(payload.get("all_tenants")), payload.get("scope"))


async def _effective_values() -> dict[str, str]:
    scope = _cache_scope()
    now = monotonic()
    cached = _effective_cache.get(scope)
    if cached is not None and now < cached[0]:
        return cached[1]

    async with _effective_cache_lock:
        now = monotonic()
        cached = _effective_cache.get(scope)
        if cached is not None and now < cached[0]:
            return cached[1]
        db_values = await _db_values()
        values = {
            key: db_values.get(key) or _env_default(key)
            for key in _DEFS_BY_KEY
        }
        _effective_cache[scope] = (
            monotonic() + SETTINGS_CACHE_TTL_SECONDS,
            values,
        )
        return values


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
        if d.hidden:
            continue
        db_value = db_values.get(d.key)
        effective = db_value if db_value else _env_default(d.key)
        items.append(
            {
                "key": d.key,
                "label": d.label,
                "group": d.group,
                "group_label": d.group_label,
                "secret": d.secret,
                "boolean": d.boolean,
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

    values = dict(values)
    if "business_timezone" in values:
        values["business_timezone"] = validate_business_timezone(
            values["business_timezone"]
        )
    if "google_calendar_enabled" in values:
        enabled = values["google_calendar_enabled"].strip().lower()
        if enabled not in {"", "true", "false"}:
            raise ValueError("El estado de Google Calendar debe ser true o false")
        values["google_calendar_enabled"] = enabled

    stored = {
        key: encrypt_secret(key, value) if value and _DEFS_BY_KEY[key].secret else value or None
        for key, value in values.items()
    }
    await settings_repository.upsert_values(stored)
    async with _effective_cache_lock:
        invalidate_settings_cache()


async def migrate_settings_encryption() -> tuple[int, int]:
    """Normaliza filas históricas según la sensibilidad de cada ajuste.

    Los tokens y API keys quedan cifrados. URLs, identificadores y parámetros
    operativos quedan en texto plano para que puedan consumirlos la UI y las
    integraciones que leen ``app_settings``. Es idempotente; un ciphertext
    corrupto o una clave incorrecta detienen el arranque antes de sobrescribirlo.
    """
    raw = await _raw_db_values()
    replacements: dict[str, str] = {}
    encrypted_count = 0
    decrypted_count = 0
    for key, value in raw.items():
        definition = _DEFS_BY_KEY.get(key)
        if not definition or not value:
            continue

        if definition.secret:
            if not needs_reencryption(key, value):
                continue
            plaintext = decrypt_secret(key, value)
            replacements[key] = encrypt_secret(key, plaintext)
            encrypted_count += 1
        elif is_encrypted(value):
            replacements[key] = decrypt_secret(key, value)
            decrypted_count += 1

    if not replacements:
        return 0, 0
    await settings_repository.update_values(replacements)
    async with _effective_cache_lock:
        invalidate_settings_cache()
    return encrypted_count, decrypted_count
