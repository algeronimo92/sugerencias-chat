"""Pestaña Correo: el SMTP propio del negocio y su correo de prueba."""

from __future__ import annotations

from fastapi import APIRouter, Depends

from app.core.errors import Invalid, Unavailable
from app.integrations.email_service import (
    EmailDeliveryError,
    EmailNotConfiguredError,
    platform_transport,
    send_test_email,
)
from app.modules.auth.public import User, require_admin
from app.modules.platform.email_settings import (
    EmailSettingsError,
    clear_email_settings,
    read_email_settings,
    save_email_settings,
)
from app.modules.platform.schemas import (
    EmailSettingsStatus,
    EmailSettingsUpdate,
    EmailTestResult,
)

router = APIRouter(prefix="/api/settings/email", tags=["settings"])


def _with_platform(values: dict) -> dict:
    return values | {"platform_available": platform_transport() is not None}


@router.get("", response_model=EmailSettingsStatus)
async def get_email_settings():
    return _with_platform(await read_email_settings())


@router.put("", response_model=EmailSettingsStatus)
async def put_email_settings(body: EmailSettingsUpdate):
    try:
        values = await save_email_settings(**body.model_dump())
    except EmailSettingsError as exc:
        raise Invalid(str(exc), code="email_settings_invalid") from exc
    return _with_platform(values)


@router.delete("", response_model=EmailSettingsStatus)
async def delete_email_settings():
    return _with_platform(await clear_email_settings())


@router.post("/test", response_model=EmailTestResult)
async def post_email_test(user: User = Depends(require_admin)):
    try:
        transport = await send_test_email(recipient=user.email)
    except EmailNotConfiguredError as exc:
        raise Unavailable(
            "No hay correo de envío configurado: carga el de tu negocio.",
            code="email_not_configured",
        ) from exc
    except EmailDeliveryError as exc:
        raise Unavailable(str(exc), code="email_delivery_failed") from exc
    return {"recipient": user.email, "source": transport.source}
