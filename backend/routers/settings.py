from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.settings_service import list_settings, update_settings

router = APIRouter(prefix="/api/settings", tags=["settings"])


class SettingItem(BaseModel):
    key: str
    label: str
    group: str
    group_label: str
    secret: bool
    configured: bool
    value: str | None = None


class UpdateSettingsRequest(BaseModel):
    values: dict[str, str]


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
