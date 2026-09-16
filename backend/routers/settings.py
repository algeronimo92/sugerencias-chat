from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import meta_service
from services.meta_service import MetaApiError
from services.settings_service import list_settings, update_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingItem(BaseModel):
    key: str
    label: str
    group: str
    group_label: str
    secret: bool
    boolean: bool = False
    configured: bool
    value: str | None = None


class UpdateSettingsRequest(BaseModel):
    values: dict[str, str]


class MetaEmbeddedSignupRequest(BaseModel):
    code: str
    waba_id: str
    # Ausente en coexistencia con la app de WhatsApp Business: ese evento
    # (FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING) no lo manda, se resuelve del
    # lado del backend -- ver meta_service.complete_embedded_signup.
    phone_number_id: str | None = None


@router.get("", response_model=list[SettingItem])
async def get_settings():
    return await list_settings()


@router.put("", response_model=list[SettingItem])
async def put_settings(body: UpdateSettingsRequest):
    try:
        await update_settings(body.values)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return await list_settings()


@router.post("/meta/embedded-signup", response_model=list[SettingItem])
async def post_meta_embedded_signup(body: MetaEmbeddedSignupRequest):
    try:
        await meta_service.complete_embedded_signup(body.code, body.waba_id, body.phone_number_id)
    except MetaApiError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return await list_settings()
