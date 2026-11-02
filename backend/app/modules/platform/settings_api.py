from app.modules.platform.schemas import (SettingItem, UpdateSettingsRequest, MetaEmbeddedSignupRequest, MetaPublicConfig, BusinessTimezoneItem)
import logging

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.integrations.meta import client as meta_service
from app.integrations.meta.client import MetaApiError
from app.modules.platform.platform_settings import platform_settings_many
from app.modules.platform.settings_service import (
    PLATFORM_MANAGED_TENANT_KEYS,
    list_business_timezones,
    list_settings,
    update_settings,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/settings", tags=["settings"])


@router.get("", response_model=list[SettingItem])
async def get_settings():
    return await list_settings()


@router.get("/timezones", response_model=list[BusinessTimezoneItem])
async def get_timezones():
    return list_business_timezones()


@router.put("", response_model=list[SettingItem])
async def put_settings(body: UpdateSettingsRequest):
    managed = sorted(set(body.values) & set(PLATFORM_MANAGED_TENANT_KEYS))
    if managed:
        raise HTTPException(
            status_code=403,
            detail=f"Estos ajustes los administra la plataforma: {', '.join(managed)}",
        )
    try:
        await update_settings(body.values)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return await list_settings()


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
        await meta_service.complete_embedded_signup(body.code, body.waba_id, body.phone_number_id)
    except MetaApiError as e:
        # El detail viaja al frontend, pero un proxy intermedio puede reemplazar
        # la respuesta 502 por su propia pantalla de error y perderlo.
        logger.error("Meta rechazó el embedded signup: %s | error=%s", e, e.error)
        raise HTTPException(status_code=502, detail=str(e))

    return await list_settings()
