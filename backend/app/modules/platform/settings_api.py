from app.modules.platform.schemas import (SettingItem, UpdateSettingsRequest, MetaEmbeddedSignupRequest, MetaAppSyncRetry, MetaPublicConfig, BusinessTimezoneItem, BusinessHoursOut, UpdateBusinessHoursRequest)
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.integrations.meta import client as meta_service
from app.integrations.meta.client import MetaApiError
from app.modules.platform.email_settings import EMAIL_KEYS
from app.modules.platform.platform_settings import platform_settings_many
from app.modules.auth.ports.types import UserRole
from app.modules.auth.public import Permission, roles_with_permission, set_role_permission
from app.modules.platform.subscribers import lead_visibility_changed
from app.modules.automations.ports.business_hours_usage import rules_using_business_hours
from app.modules.platform.business_hours import (
    BUSINESS_HOURS_KEY,
    DEFAULT_TIMEZONE,
    days_from_setting,
    parse_days,
    serialize_days,
)
from app.modules.platform.settings_service import (
    PLATFORM_MANAGED_TENANT_KEYS,
    get_effective_many,
    list_business_timezones,
    list_settings,
    update_settings,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])

# Desde 2026-11-20 lo decide la matriz de permisos (``leads.view_all`` del
# vendedor). El interruptor de Configuración sigue existiendo: se lee y se
# escribe sobre la matriz. El valor guardado en ``app_settings`` lo sigue
# escribiendo para el color viejo de un despliegue blue-green.
SELLER_VISIBILITY_KEY = "sellers_see_only_assigned_leads"


async def _settings_out() -> list[dict]:
    scoped = UserRole.SELLER not in await roles_with_permission(Permission.LEADS_VIEW_ALL)
    return [
        {**item, "value": "true" if scoped else "false", "configured": True}
        if item["key"] == SELLER_VISIBILITY_KEY else item
        for item in await list_settings()
    ]


@router.get("", response_model=list[SettingItem])
async def get_settings():
    return await _settings_out()


@router.get("/timezones", response_model=list[BusinessTimezoneItem])
async def get_timezones():
    return list_business_timezones()


# Lo que se muestra en un día cerrado si alguien lo vuelve a abrir.
_CLOSED_DAY_HOURS = ("09:00", "13:00")


async def _business_hours_out() -> dict:
    values = await get_effective_many((BUSINESS_HOURS_KEY, "business_timezone"))
    days = days_from_setting(values[BUSINESS_HOURS_KEY])
    return {
        "days": [
            {
                "weekday": weekday,
                "open": weekday in days,
                "start": f"{days[weekday][0]:%H:%M}" if weekday in days else _CLOSED_DAY_HOURS[0],
                "end": f"{days[weekday][1]:%H:%M}" if weekday in days else _CLOSED_DAY_HOURS[1],
            }
            for weekday in range(7)
        ],
        "timezone": values["business_timezone"].strip() or DEFAULT_TIMEZONE,
        "configured": bool(values[BUSINESS_HOURS_KEY].strip()),
        "used_by": await rules_using_business_hours(),
    }


@router.get("/business-hours", response_model=BusinessHoursOut)
async def get_business_hours():
    return await _business_hours_out()


@router.put("/business-hours", response_model=BusinessHoursOut)
async def put_business_hours(body: UpdateBusinessHoursRequest):
    if sorted(day.weekday for day in body.days) != list(range(7)):
        raise HTTPException(status_code=422, detail="El horario debe traer los siete días, una vez cada uno")
    try:
        days = parse_days({day.weekday: [day.start, day.end] for day in body.days if day.open})
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    await update_settings({BUSINESS_HOURS_KEY: serialize_days(days)})
    return await _business_hours_out()


@router.put("", response_model=list[SettingItem])
async def put_settings(body: UpdateSettingsRequest):
    managed = sorted(set(body.values) & set(PLATFORM_MANAGED_TENANT_KEYS))
    if managed:
        raise HTTPException(
            status_code=403,
            detail=f"Estos ajustes los administra la plataforma: {', '.join(managed)}",
        )
    email_keys = sorted(set(body.values) & set(EMAIL_KEYS))
    if email_keys:
        # Se guardan juntos y validados desde la pestaña Correo.
        raise HTTPException(
            status_code=400,
            detail="El correo de envío se configura en la pestaña Correo",
        )
    try:
        await update_settings(body.values)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if SELLER_VISIBILITY_KEY in body.values:
        scoped = body.values[SELLER_VISIBILITY_KEY].strip().lower() == "true"
        await set_role_permission(UserRole.SELLER, Permission.LEADS_VIEW_ALL, granted=not scoped)
        await lead_visibility_changed()
    return await _settings_out()


@router.get("/meta/public-config", response_model=MetaPublicConfig)
async def get_meta_public_config():
    values = await platform_settings_many(("meta_app_id", "meta_config_id"))
    return {
        "app_id": values["meta_app_id"] or None,
        "config_id": values["meta_config_id"] or None,
    }


@router.post("/meta/embedded-signup", response_model=list[SettingItem])
async def post_meta_embedded_signup(body: MetaEmbeddedSignupRequest):
    try:
        await meta_service.complete_embedded_signup(body.code, body.waba_id, body.phone_number_id, body.mode)
    except MetaApiError as e:
        # El detail viaja al frontend, pero un proxy intermedio puede reemplazar
        # la respuesta 502 por su propia pantalla de error y perderlo.
        logger.error("Meta rechazó el embedded signup: %s | error=%s", e, e.error)
        raise HTTPException(status_code=502, detail=str(e))

    return await list_settings()


@router.post("/meta/app-sync/retry", response_model=MetaAppSyncRetry)
async def post_meta_app_sync_retry():
    """Repite el pedido de contactos e historial de la app del celular que
    falló al conectar el número, mientras Meta todavía lo acepte."""
    try:
        retried = await meta_service.retry_app_data_sync()
    except MetaApiError as e:
        raise HTTPException(status_code=502, detail=str(e))
    return {"retried": retried}
