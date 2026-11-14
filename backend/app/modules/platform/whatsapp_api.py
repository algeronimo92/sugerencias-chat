import logging
import re
from datetime import date

from fastapi import APIRouter, HTTPException, Query

from app.integrations.meta import client as meta_service
from app.modules.leads.ports.ad_conversions import conversions_summary
from app.modules.leads.schemas import MetaConversionsStatus, MetaConversionsUpdate
from app.modules.platform.meta_costs import sync_meta_costs
from app.modules.platform.meta_costs_queries import monthly_costs
from app.modules.platform.schemas import WhatsappCostsSummary, WhatsappStatusItem
from app.modules.platform.settings_service import get_effective_many, update_settings

router = APIRouter(prefix="/api/whatsapp", tags=["whatsapp"])
logger = logging.getLogger(__name__)

_MONTH_RE = re.compile(r"^\d{4}-(0[1-9]|1[0-2])$")


@router.get("/status", response_model=WhatsappStatusItem)
async def whatsapp_status():
    """Si el número de Meta Cloud API está conectado. No hay ciclo de QR ni
    desconexión: el número queda vinculado por el Embedded Signup."""
    if await meta_service.is_configured():
        return {"state": "open", "instance": None}
    return {"state": "not_configured", "instance": None}


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
        await sync_meta_costs(meta_service.fetch_pricing_analytics)
    except meta_service.MetaApiError as exc:
        logger.warning("No se pudieron traer los costos de Meta: %s", exc)
        raise HTTPException(502, "Meta no devolvió los costos. Intenta de nuevo en unos minutos.")
    return await monthly_costs(_month(month))


_CONVERSION_KEYS = ("meta_conversions_enabled", "meta_dataset_id")


async def _conversions_status() -> dict:
    values = await get_effective_many(_CONVERSION_KEYS)
    return {
        "enabled": values["meta_conversions_enabled"].strip().lower() == "true",
        "dataset_id": values["meta_dataset_id"].strip() or None,
        **await conversions_summary(),
    }


@router.get("/conversions", response_model=MetaConversionsStatus)
async def whatsapp_conversions():
    """La API de Conversiones de Meta: si el negocio la activó y los eventos
    de cita que se mandaron por leads de anuncios."""
    return await _conversions_status()


@router.put("/conversions", response_model=MetaConversionsStatus)
async def update_whatsapp_conversions(body: MetaConversionsUpdate):
    """Activa o pausa el envío. Al activar busca (o crea) el dataset de la
    WABA en Meta: si el token no tiene ``whatsapp_business_manage_events``,
    Meta lo rechaza acá y no se activa nada."""
    if not body.enabled:
        await update_settings({"meta_conversions_enabled": "false"})
        return await _conversions_status()
    if not await meta_service.is_configured():
        raise HTTPException(409, "WhatsApp no está conectado")
    try:
        dataset_id = await meta_service.conversions_dataset()
    except meta_service.MetaApiError as exc:
        logger.warning("Meta no entregó el dataset de conversiones: %s", exc)
        raise HTTPException(
            502,
            "Meta no permitió activar la API de Conversiones. Vuelve a conectar WhatsApp "
            "para conceder el permiso de eventos e intenta de nuevo.",
        )
    await update_settings({"meta_conversions_enabled": "true", "meta_dataset_id": dataset_id})
    return await _conversions_status()
