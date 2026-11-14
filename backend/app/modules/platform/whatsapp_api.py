import logging
import re
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query

from app.integrations.meta import client as meta_service
from app.modules.auth.public import User, require_admin
from app.modules.leads.ports.ad_conversions import (
    ACCEPTED_AT_KEY,
    ACCEPTED_BY_KEY,
    DATASET_KEY,
    ENABLED_KEY,
    TEST_CODE_KEY,
    conversions_summary,
)
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


@router.put("/conversions", response_model=MetaConversionsStatus)
async def update_whatsapp_conversions(body: MetaConversionsUpdate, user: User = Depends(require_admin)):
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
