"""Panel de plataforma: alta y administración de negocios.

Solo responde en los hosts declarados en `TENANT_PLATFORM_HOSTS`; el middleware
de tenancy rechaza estas rutas en el dominio de cualquier negocio, para que un
CRM comprometido no pueda alcanzarlas (ver tenancy/middleware.py).
"""

from __future__ import annotations

import base64
import binascii
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from db.models import PlatformUser
from services.auth_service import cookie_is_secure, hash_password
from services.login_throttle import LoginThrottledError, clear_account_attempts, reserve_login_attempt
from services import branding as branding_service
from services.ai_access import AIEntitlement
from services.platform_organizations import (
    OrganizationNotFoundError,
    organization_ai,
    organization_integrations,
    update_organization_ai,
    update_organization_integrations,
)
from services.platform_organizations import list_organizations as listar_organizaciones
from services.platform_settings import list_platform_settings, update_platform_settings
from services.platform_auth import (
    PLATFORM_COOKIE_NAME,
    SESSION_HOURS,
    authenticate,
    get_current_platform_user,
    revoke_platform_session,
)
from tenancy.provisioning import (
    TenantProvisioningError,
    activate_organization,
    add_organization_domain,
    provision_tenant,
    remove_organization_domain,
    suspend_organization,
)


router = APIRouter(prefix="/api/platform", tags=["platform"])
protected = [Depends(get_current_platform_user)]


class LoginBody(BaseModel):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1)


class DomainBody(BaseModel):
    hostname: str = Field(min_length=1, max_length=253)
    is_primary: bool = False


class NewOrganizationBody(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    hostname: str = Field(min_length=1, max_length=253)
    admin_email: str | None = Field(default=None, max_length=254)
    admin_password: str | None = Field(default=None, min_length=8)
    settings: dict[str, str] = Field(default_factory=dict)


class PlatformSettingItem(BaseModel):
    key: str
    label: str
    secret: bool
    configured: bool
    source: str
    value: str | None = None


class UpdatePlatformSettingsBody(BaseModel):
    values: dict[str, str]


class OrganizationAIBody(BaseModel):
    enabled: bool
    # NULL = sin tope. Se cuentan generaciones por mes calendario UTC.
    monthly_quota: int | None = Field(default=None, ge=0, le=1_000_000)


class OrganizationAIItem(BaseModel):
    enabled: bool
    monthly_quota: int | None = None
    used_this_month: int


class OrganizationIntegrationItem(BaseModel):
    key: str
    label: str
    configured: bool
    value: str | None = None


class BrandingBody(BaseModel):
    # Vacío vuelve a los valores de la plataforma (nombre de la organización
    # y color por defecto).
    display_name: str | None = Field(default=None, max_length=branding_service.MAX_NAME_LENGTH)
    primary_color: str | None = Field(default=None, max_length=7)


class BrandingLogoBody(BaseModel):
    data_base64: str = Field(min_length=1)


class BrandingItem(BaseModel):
    name: str
    display_name: str | None = None
    primary_color: str
    has_logo: bool
    version: int
    contrast_with_white: float


async def _branding_item(organization_id: UUID) -> dict:
    current = await branding_service.get_branding(organization_id)
    raw = await branding_service.get_raw_branding(organization_id)
    return {
        "name": current.name,
        "display_name": raw.get("display_name"),
        "primary_color": current.primary_color,
        "has_logo": current.has_logo,
        "version": current.version,
        "contrast_with_white": round(branding_service.contrast_with_white(current.primary_color), 2),
    }


def _organization_not_found() -> HTTPException:
    return HTTPException(status_code=404, detail="Negocio no encontrado o sin espacio listo")


@router.post("/auth/login")
async def login(body: LoginBody, request: Request, response: Response) -> dict:
    email = body.email.strip().lower()
    try:
        await reserve_login_attempt(email, request.client.host if request.client else "unknown", scope="platform")
    except LoginThrottledError as exc:
        raise HTTPException(
            status_code=429,
            detail="Demasiados intentos. Espera antes de volver a probar.",
            headers={"Retry-After": str(exc.retry_after_seconds)},
        ) from exc
    token = await authenticate(body.email, body.password)
    if token is None:
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
    await clear_account_attempts(email, scope="platform")
    response.set_cookie(
        PLATFORM_COOKIE_NAME,
        token,
        httponly=True,
        samesite="lax",
        secure=cookie_is_secure(request),
        path="/",
        max_age=SESSION_HOURS * 3600,
    )
    return {"status": "ok"}


@router.post("/auth/logout")
async def logout(request: Request, response: Response) -> dict:
    await revoke_platform_session(request.cookies.get(PLATFORM_COOKIE_NAME))
    response.delete_cookie(PLATFORM_COOKIE_NAME, path="/")
    return {"status": "ok"}


@router.get("/auth/me", dependencies=protected)
async def me(user: PlatformUser = Depends(get_current_platform_user)) -> dict:
    return {"id": str(user.id), "email": user.email, "name": user.name}


@router.get("/organizations", dependencies=protected)
async def list_organizations() -> dict:
    return await listar_organizaciones()


@router.get("/settings", dependencies=protected, response_model=list[PlatformSettingItem])
async def get_platform_settings():
    return await list_platform_settings()


@router.put("/settings", dependencies=protected, response_model=list[PlatformSettingItem])
async def put_platform_settings(body: UpdatePlatformSettingsBody):
    try:
        await update_platform_settings(body.values)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return await list_platform_settings()


@router.post("/organizations", dependencies=protected, status_code=201)
async def create_organization(body: NewOrganizationBody) -> dict:
    if bool(body.admin_email) != bool(body.admin_password):
        raise HTTPException(
            status_code=422, detail="El correo y la contraseña del admin van juntos"
        )
    try:
        context = await provision_tenant(
            name=body.name,
            hostname=body.hostname,
            initial_settings=body.settings or None,
            admin_email=body.admin_email,
            admin_password_hash=hash_password(body.admin_password)
            if body.admin_password
            else None,
        )
    except TenantProvisioningError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "id": str(context.organization_id),
        "hostname": context.hostname,
        "schema_name": context.schema_name,
        "storage_prefix": context.storage_path,
    }


@router.post("/organizations/{organization_id}/domains", dependencies=protected, status_code=201)
async def add_domain(organization_id: UUID, body: DomainBody) -> dict:
    try:
        hostname = await add_organization_domain(
            organization_id, body.hostname, is_primary=body.is_primary
        )
    except TenantProvisioningError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"hostname": hostname}


@router.delete("/organizations/{organization_id}/domains/{hostname}", dependencies=protected)
async def delete_domain(organization_id: UUID, hostname: str) -> dict:
    try:
        await remove_organization_domain(organization_id, hostname)
    except TenantProvisioningError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {"status": "ok"}


@router.post("/organizations/{organization_id}/suspend", dependencies=protected)
async def suspend(organization_id: UUID) -> dict:
    try:
        await suspend_organization(organization_id)
    except TenantProvisioningError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"status": "suspended"}


@router.post("/organizations/{organization_id}/activate", dependencies=protected)
async def activate(organization_id: UUID) -> dict:
    try:
        await activate_organization(organization_id)
    except TenantProvisioningError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return {"status": "active"}


@router.get(
    "/organizations/{organization_id}/ai",
    dependencies=protected,
    response_model=OrganizationAIItem,
)
async def get_organization_ai(organization_id: UUID):
    try:
        return await organization_ai(organization_id)
    except OrganizationNotFoundError as exc:
        raise _organization_not_found() from exc


@router.put(
    "/organizations/{organization_id}/ai",
    dependencies=protected,
    response_model=OrganizationAIItem,
)
async def put_organization_ai(organization_id: UUID, body: OrganizationAIBody):
    try:
        return await update_organization_ai(
            organization_id,
            AIEntitlement(enabled=body.enabled, monthly_quota=body.monthly_quota),
        )
    except OrganizationNotFoundError as exc:
        raise _organization_not_found() from exc


@router.get(
    "/organizations/{organization_id}/integrations",
    dependencies=protected,
    response_model=list[OrganizationIntegrationItem],
)
async def get_organization_integrations(organization_id: UUID):
    try:
        return await organization_integrations(organization_id)
    except OrganizationNotFoundError as exc:
        raise _organization_not_found() from exc


@router.put(
    "/organizations/{organization_id}/integrations",
    dependencies=protected,
    response_model=list[OrganizationIntegrationItem],
)
async def put_organization_integrations(organization_id: UUID, body: UpdatePlatformSettingsBody):
    try:
        return await update_organization_integrations(organization_id, body.values)
    except OrganizationNotFoundError as exc:
        raise _organization_not_found() from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get(
    "/organizations/{organization_id}/branding",
    dependencies=protected,
    response_model=BrandingItem,
)
async def get_organization_branding(organization_id: UUID):
    try:
        return await _branding_item(organization_id)
    except branding_service.OrganizationNotFound as exc:
        raise _organization_not_found() from exc


@router.put(
    "/organizations/{organization_id}/branding",
    dependencies=protected,
    response_model=BrandingItem,
)
async def put_organization_branding(organization_id: UUID, body: BrandingBody):
    try:
        await branding_service.update_branding(
            organization_id,
            display_name=body.display_name,
            primary_color=body.primary_color,
        )
        return await _branding_item(organization_id)
    except branding_service.OrganizationNotFound as exc:
        raise _organization_not_found() from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.put(
    "/organizations/{organization_id}/branding/logo",
    dependencies=protected,
    response_model=BrandingItem,
)
async def put_organization_logo(organization_id: UUID, body: BrandingLogoBody):
    try:
        raw = base64.b64decode(body.data_base64, validate=True)
    except (binascii.Error, ValueError) as exc:
        raise HTTPException(status_code=422, detail="El logo no es un archivo válido") from exc
    try:
        await branding_service.set_logo(organization_id, raw)
        return await _branding_item(organization_id)
    except branding_service.OrganizationNotFound as exc:
        raise _organization_not_found() from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.delete(
    "/organizations/{organization_id}/branding/logo",
    dependencies=protected,
    response_model=BrandingItem,
)
async def delete_organization_logo(organization_id: UUID):
    try:
        await branding_service.remove_logo(organization_id)
        return await _branding_item(organization_id)
    except branding_service.OrganizationNotFound as exc:
        raise _organization_not_found() from exc


@router.get("/organizations/{organization_id}/branding/logo", dependencies=protected)
async def get_organization_logo(organization_id: UUID):
    """Vista previa del logo en el panel (el host de plataforma no resuelve
    negocios, así que no puede usar /api/branding/logo)."""
    logo = await branding_service.get_logo(organization_id, branding_service.LOGO_SIZE)
    if logo is None:
        raise HTTPException(status_code=404, detail="El negocio no tiene logo")
    return Response(
        content=logo,
        media_type="image/png",
        headers={"Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff"},
    )
