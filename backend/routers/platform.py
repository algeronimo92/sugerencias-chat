"""Panel de plataforma: alta y administración de negocios.

Solo responde en los hosts declarados en `TENANT_PLATFORM_HOSTS`; el middleware
de tenancy rechaza estas rutas en el dominio de cualquier negocio, para que un
CRM comprometido no pueda alcanzarlas (ver tenancy/middleware.py).
"""

from __future__ import annotations

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from db.models import PlatformUser
from services.auth_service import cookie_is_secure, hash_password
from services.platform_organizations import list_organizations as listar_organizaciones
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


@router.post("/auth/login")
async def login(body: LoginBody, request: Request, response: Response) -> dict:
    token = await authenticate(body.email, body.password)
    if token is None:
        raise HTTPException(status_code=401, detail="Credenciales inválidas")
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
