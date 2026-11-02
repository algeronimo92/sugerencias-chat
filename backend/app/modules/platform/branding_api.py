"""Marca del negocio para el CRM, antes y después del login.

Rutas públicas: el negocio sale del dominio (lo resolvió el middleware de
tenancy) y lo que devuelven es lo mismo que ya muestra la pantalla de acceso.
Sin negocio (instalación single-tenant) se usa la marca de la plataforma.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Response
from fastapi.responses import JSONResponse

from app.modules.platform.branding import (
    DEFAULT_BRANDING,
    ICON_SIZE,
    LOGO_SIZE,
    Branding,
    OrganizationNotFound,
    get_branding,
    get_logo,
    web_manifest,
)
from app.tenancy.context import get_current_tenant

router = APIRouter(prefix="/api/branding", tags=["branding"])

# La marca cambia muy poco; el logo lleva la versión en la URL, así que puede
# cachearse largo sin quedar viejo tras un cambio.
_BRANDING_CACHE = "public, max-age=300"
_LOGO_CACHE = "public, max-age=604800, immutable"


async def _current_branding() -> Branding:
    context = get_current_tenant()
    if context is None:
        return DEFAULT_BRANDING
    try:
        return await get_branding(context.organization_id)
    except OrganizationNotFound:
        return DEFAULT_BRANDING


@router.get("")
async def read_branding(response: Response) -> dict:
    response.headers["Cache-Control"] = _BRANDING_CACHE
    return (await _current_branding()).as_public_dict()


@router.get("/logo")
async def read_logo(size: int = Query(default=LOGO_SIZE)) -> Response:
    if size not in (LOGO_SIZE, ICON_SIZE):
        raise HTTPException(status_code=400, detail=f"Tamaños disponibles: {ICON_SIZE} y {LOGO_SIZE}")
    context = get_current_tenant()
    logo = await get_logo(context.organization_id, size) if context is not None else None
    if logo is None:
        raise HTTPException(status_code=404, detail="El negocio no tiene logo")
    return Response(
        content=logo,
        media_type="image/png",
        headers={
            "Cache-Control": _LOGO_CACHE,
            "X-Content-Type-Options": "nosniff",
        },
    )


@router.get("/manifest.webmanifest")
async def read_manifest() -> JSONResponse:
    return JSONResponse(
        web_manifest(await _current_branding()),
        media_type="application/manifest+json",
        headers={"Cache-Control": _BRANDING_CACHE},
    )
