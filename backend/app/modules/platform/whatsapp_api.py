import logging
import re
from datetime import date, datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query

from app.integrations.meta import client as meta_service
from app.modules.auth.public import User, Permission, require_permission
from app.modules.leads.ports.ad_conversions import (
    ACCEPTED_AT_KEY,
    ACCEPTED_BY_KEY,
    DATASET_KEY,
    ENABLED_KEY,
    TEST_CODE_KEY,
    conversion_events,
    conversions_summary,
)
from app.modules.leads.schemas import MetaConversionPage, MetaConversionsStatus, MetaConversionsUpdate
from app.modules.platform.meta_costs import sync_all_meta_costs
from app.modules.platform.meta_costs_queries import monthly_costs
from app.modules.auth.ports.users import list_call_agents
from app.modules.platform.calling_readiness import (
    InvalidCallHours,
    calling_for_meta,
    calling_from_meta,
    calling_readiness,
)
from app.modules.platform.schemas import (
    WhatsappCallingReadiness,
    WhatsappCallingSettings,
    WhatsappCallingUpdate,
    WhatsappCostsSummary,
    WhatsappStatusItem,
)
from app.modules.platform.settings_service import get_effective_many, update_settings

require_settings_manage = require_permission(Permission.SETTINGS_MANAGE)

router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])
# Aparte del resto, que es de administración: quien atiende los chats también
# tiene que ver que WhatsApp se desconectó. Solo dice el estado, sin credenciales.
status_router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])
logger = logging.getLogger(__name__)

_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


@status_router.get("/status", response_model=WhatsappStatusItem)
async def whatsapp_status():
    """Si el número de Meta Cloud API está conectado. No hay ciclo de QR: el
    número queda vinculado por el Embedded Signup hasta que el negocio lo
    desvincula desde WhatsApp, y eso solo se sabe porque Meta lo avisa."""
    if not await meta_service.is_configured():
        return {"state": "not_configured", "instance": None}
    disconnected_at = await meta_service.disconnected_since()
    if disconnected_at is not None:
        return {"state": "disconnected", "instance": None, "disconnected_at": disconnected_at}
    return {"state": "open", "instance": None}


@router.get("/calling-readiness", response_model=WhatsappCallingReadiness)
async def whatsapp_calling_readiness():
    """Si el número puede activar las llamadas, preguntado a Meta en el
    momento: no se guarda, porque cambia fuera del CRM (el negocio muda el
    número o Meta le sube el límite) y nadie avisa."""
    if not await meta_service.is_configured():
        return calling_readiness(None)
    try:
        requirements = await meta_service.get_calling_requirements()
    except (meta_service.MetaApiError, httpx.HTTPError) as exc:
        logger.warning("No se pudo consultar a Meta el estado para llamadas: %s", exc)
        raise HTTPException(502, "Meta no respondió. Intenta de nuevo en unos minutos.")
    return calling_readiness(requirements)


CALL_PERMISSION_KEY = "meta_call_permission_enabled"


async def _calling_settings() -> dict:
    try:
        calling = await meta_service.get_calling_settings()
    except (meta_service.MetaApiError, httpx.HTTPError) as exc:
        logger.warning("No se pudo leer la configuración de llamadas de Meta: %s", exc)
        raise HTTPException(502, "Meta no respondió. Intenta de nuevo en unos minutos.")
    return {**calling_from_meta(calling), "agents": len(await list_call_agents())}


@router.get("/calling", response_model=WhatsappCallingSettings)
async def whatsapp_calling():
    """Si las llamadas están activas en el número y con qué horario."""
    if not await meta_service.is_configured():
        raise HTTPException(409, "WhatsApp no está conectado")
    return await _calling_settings()


@router.put("/calling", response_model=WhatsappCallingSettings)
async def update_whatsapp_calling(body: WhatsappCallingUpdate):
    """Activa o desactiva las llamadas en Meta y fija su horario. No se
    activan sin nadie que atienda: sonarían en el vacío y Meta oculta el
    botón de llamar cuando pocas llamadas se atienden."""
    if not await meta_service.is_configured():
        raise HTTPException(409, "WhatsApp no está conectado")
    if body.enabled and not await list_call_agents():
        raise HTTPException(409, "Elige primero quiénes atienden las llamadas")
    timezone = (await get_effective_many(("business_timezone",)))["business_timezone"].strip() or "America/Lima"
    try:
        calling = calling_for_meta(
            enabled=body.enabled, hours=[slot.model_dump() for slot in body.hours], timezone=timezone,
        )
    except InvalidCallHours as exc:
        raise HTTPException(422, str(exc))
    try:
        await meta_service.update_calling_settings(calling)
    except meta_service.MetaApiError as exc:
        logger.warning("Meta no aceptó la configuración de llamadas: %s", exc)
        raise HTTPException(502, "Meta no aceptó el cambio. Revisa que el número cumpla los requisitos para llamadas.")
    except httpx.HTTPError as exc:
        logger.warning("Meta no respondió al configurar llamadas: %s", exc)
        raise HTTPException(502, "Meta no respondió. Intenta de nuevo en unos minutos.")
    # El pedido de permiso de llamada del chat sigue al estado real en Meta.
    await update_settings({CALL_PERMISSION_KEY: "true" if body.enabled else "false"})
    return await _calling_settings()


def _month(value: str | None) -> date:
    if value is None:
        return date.today().replace(day=1)
    if not _MONTH_RE.match(value):
        raise HTTPException(422, "El mes va como AAAA-MM")
    year, month = value.split("-")
    return date(int(year), int(month), 1)


@router.get("/costs", response_model=WhatsappCostsSummary)
async def whatsapp_costs(month: str | None = Query(default=None)):
    """Lo que Meta informó que cobró en el mes (copia que mantiene el worker)."""
    return await monthly_costs(_month(month))


@router.post("/costs/sync", response_model=WhatsappCostsSummary)
async def sync_whatsapp_costs(month: str | None = Query(default=None)):
    """Pide a Meta los días pendientes ahora, sin esperar al worker."""
    if not await meta_service.is_configured():
        raise HTTPException(409, "WhatsApp no está conectado")
    try:
        await sync_all_meta_costs(meta_service.fetch_pricing_analytics, await meta_service.notice_waba_id())
    except meta_service.MetaApiError as exc:
        logger.warning("No se pudieron traer los costos de Meta: %s", exc)
        raise HTTPException(502, "Meta no devolvió los costos. Intenta de nuevo en unos minutos.")
    return await monthly_costs(_month(month))


_CONVERSION_KEYS = (ENABLED_KEY, DATASET_KEY, TEST_CODE_KEY, ACCEPTED_BY_KEY, ACCEPTED_AT_KEY)


async def _conversions_status() -> dict:
    values = await get_effective_many(_CONVERSION_KEYS)
    return {
        "enabled": values[ENABLED_KEY].strip().lower() == "true",
        "accepted_by": values[ACCEPTED_BY_KEY].strip() or None,
        "accepted_at": values[ACCEPTED_AT_KEY].strip() or None,
        "dataset_id": values[DATASET_KEY].strip() or None,
        "test_event_code": values[TEST_CODE_KEY].strip() or None,
        **await conversions_summary(),
    }


@router.get("/conversions", response_model=MetaConversionsStatus)
async def whatsapp_conversions():
    """La API de Conversiones de Meta: si está encendida, quién la autorizó
    y cómo van los eventos de los leads que llegaron por anuncios."""
    return await _conversions_status()


@router.get("/conversions/events", response_model=MetaConversionPage)
async def whatsapp_conversion_events(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=50),
):
    """El historial de eventos informados (o por informar) a Meta, paginado."""
    return await conversion_events(page=page, page_size=page_size)


@router.put("/conversions", response_model=MetaConversionsStatus)
async def update_whatsapp_conversions(body: MetaConversionsUpdate, user: User = Depends(require_settings_manage)):
    """Enciende o apaga el envío y guarda el código de prueba. Encender exige
    aceptar las Condiciones de las herramientas comerciales de Meta (queda
    quién y cuándo) y obtener el dataset de la WABA: si el token no tiene
    ``whatsapp_business_manage_events``, Meta lo rechaza acá y no se enciende."""
    values: dict[str, str] = {}
    if body.test_event_code is not None:
        values[TEST_CODE_KEY] = body.test_event_code.strip()
    current = await get_effective_many((ENABLED_KEY,))
    if not body.enabled or current[ENABLED_KEY].strip().lower() == "true":
        # Apagar, o cambiar el código de prueba con la función ya encendida:
        # la aceptación registrada sigue siendo la de quien la encendió.
        await update_settings({**values, ENABLED_KEY: "true" if body.enabled else "false"})
        return await _conversions_status()
    if not body.accept_terms:
        raise HTTPException(422, "Para activarlo hay que aceptar las Condiciones de las herramientas comerciales de Meta")
    if not await meta_service.is_configured():
        raise HTTPException(409, "WhatsApp no está conectado")
    try:
        dataset_id = await meta_service.ensure_dataset()
    except meta_service.MetaApiError as exc:
        logger.warning("Meta no entregó el dataset de conversiones: %s", exc)
        raise HTTPException(
            502,
            "Meta no permitió activar la API de Conversiones. Vuelve a conectar WhatsApp "
            "para conceder el permiso de eventos e intenta de nuevo.",
        )
    await update_settings({
        **values, ENABLED_KEY: "true", DATASET_KEY: dataset_id,
        ACCEPTED_BY_KEY: f"{user.name} ({user.email})", ACCEPTED_AT_KEY: datetime.now(timezone.utc).isoformat(),
    })
    return await _conversions_status()
