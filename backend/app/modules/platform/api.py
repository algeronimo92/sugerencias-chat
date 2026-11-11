"""Panel de plataforma: alta y administración de negocios.

Solo responde en los hosts declarados en `TENANT_PLATFORM_HOSTS`; el middleware
de tenancy rechaza estas rutas en el dominio de cualquier negocio, para que un
CRM comprometido no pueda alcanzarlas (ver app/tenancy/middleware.py).
"""

from __future__ import annotations
from app.modules.platform.schemas import (LoginBody, DomainBody, NewOrganizationBody, StarterPackResult, PlatformSettingItem, UpdatePlatformSettingsBody, OrganizationAIBody, OrganizationAIItem, OrganizationIntegrationItem, BrandingBody, BrandingLogoBody, BrandingItem, OperatorItem, OrganizationList, KnowledgeTemplateBody, KnowledgeTemplateItem, KnowledgeTemplateUpdate, EmailTestResult, OrganizationOverview, PlatformEmailStatus, PlatformEmailUpdate)

import base64
import binascii
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel, Field
from app.db.models.control import PlatformUser
from app.modules.auth.public import cookie_is_secure, hash_password
from app.modules.auth.public import LoginThrottledError, clear_account_attempts, reserve_login_attempt
from app.modules.platform import branding as branding_service
from app.modules.platform import knowledge_templates
from app.modules.ai.public import AIEntitlement
from app.modules.platform.platform_organizations import (
    OrganizationNotFoundError,
    apply_organization_starter_pack,
    organization_ai,
    organization_integrations,
    organization_overview,
    update_organization_ai,
    update_organization_integrations,
)
from app.modules.platform.platform_organizations import list_organizations as listar_organizaciones
from app.modules.platform.starter_pack import apply_starter_pack
from app.modules.platform.platform_settings import list_platform_settings, update_platform_settings
from app.core.errors import Invalid, Unavailable
from app.integrations.email_service import (
    EmailDeliveryError,
    EmailNotConfiguredError,
    platform_transport,
    send_test_email,
)
from app.modules.platform.email_settings import EmailSettingsError
from app.modules.platform.platform_email import (
    clear_platform_email,
    read_platform_email,
    save_platform_email,
)
from app.modules.platform.platform_auth import (
    PLATFORM_COOKIE_NAME,
    SESSION_HOURS,
    authenticate,
    get_current_platform_user,
    revoke_platform_session,
)
from app.tenancy.provisioning import (
    TenantProvisioningError,
    activate_organization,
    add_organization_domain,
    provision_tenant,
    remove_organization_domain,
    suspend_organization,
)


router = APIRouter(prefix="/api/platform", tags=["platform"])
protected = [Depends(get_current_platform_user)]


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


@router.get("/auth/me", dependencies=protected, response_model=OperatorItem)
async def me(user: PlatformUser = Depends(get_current_platform_user)) -> dict:
    return {"id": str(user.id), "email": user.email, "name": user.name}


@router.get("/organizations", dependencies=protected, response_model=OrganizationList)
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


@router.get("/email", dependencies=protected, response_model=PlatformEmailStatus)
async def get_platform_email():
    return await read_platform_email()


@router.put("/email", dependencies=protected, response_model=PlatformEmailStatus)
async def put_platform_email(body: PlatformEmailUpdate):
    try:
        return await save_platform_email(**body.model_dump())
    except EmailSettingsError as exc:
        raise Invalid(str(exc), code="email_settings_invalid") from exc


@router.delete("/email", dependencies=protected, response_model=PlatformEmailStatus)
async def delete_platform_email():
    return await clear_platform_email()


@router.post("/email/test", dependencies=protected, response_model=EmailTestResult)
async def post_platform_email_test(user: PlatformUser = Depends(get_current_platform_user)):
    # Solo al correo del operador que prueba: el panel no debe servir para
    # mandar correos a direcciones arbitrarias desde el remitente de la
    # plataforma.
    try:
        transport = await send_test_email(recipient=user.email, transport=await platform_transport())
    except EmailNotConfiguredError as exc:
        raise Unavailable(
            "No hay correo de la plataforma configurado.", code="email_not_configured"
        ) from exc
    except EmailDeliveryError as exc:
        raise Unavailable(str(exc), code="email_delivery_failed") from exc
    return {"recipient": user.email, "source": transport.source}


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
            starter_pack=apply_starter_pack if body.starter_pack else None,
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
    "/organizations/{organization_id}/overview",
    dependencies=protected,
    response_model=OrganizationOverview,
)
async def get_organization_overview(organization_id: UUID):
    try:
        return await organization_overview(organization_id)
    except OrganizationNotFoundError as exc:
        raise _organization_not_found() from exc


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


@router.post(
    "/organizations/{organization_id}/starter-pack",
    dependencies=protected,
    response_model=StarterPackResult,
)
async def post_organization_starter_pack(organization_id: UUID):
    try:
        return await apply_organization_starter_pack(organization_id)
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


@router.get("/knowledge-templates", dependencies=protected, response_model=list[KnowledgeTemplateItem])
async def get_knowledge_templates():
    return await knowledge_templates.list_templates(include_inactive=True)


@router.post("/knowledge-templates", dependencies=protected, response_model=KnowledgeTemplateItem, status_code=201)
async def post_knowledge_template(body: KnowledgeTemplateBody):
    try:
        return await knowledge_templates.create_template(body.model_dump())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/knowledge-templates/{template_id}", dependencies=protected, response_model=KnowledgeTemplateItem)
async def put_knowledge_template(template_id: int, body: KnowledgeTemplateUpdate):
    """Editar sube la versión; las copias que ya importaron los negocios no cambian."""
    values = body.model_dump(exclude_unset=True)
    try:
        template = await knowledge_templates.update_template(template_id, values)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if template is None:
        raise HTTPException(status_code=404, detail="Plantilla no encontrada")
    return template
