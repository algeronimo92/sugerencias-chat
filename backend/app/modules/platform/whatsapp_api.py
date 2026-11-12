import logging
import re
from datetime import date

import httpx
from fastapi import APIRouter, HTTPException, Query

from app.integrations.meta import client as meta_service
from app.integrations.evolution import client as evolution_service
from app.integrations.whatsapp.channel import ChannelError
from app.modules.platform.meta_costs import sync_meta_costs
from app.modules.platform.meta_costs_queries import monthly_costs
from app.modules.platform.schemas import (
    EvolutionConnectRequest,
    EvolutionStatusItem,
    WhatsappCostsSummary,
    WhatsappStatusItem,
)
from app.tenancy.context import get_current_tenant
from app.tenancy.provisioning import disable_whatsapp_connection, sync_whatsapp_connection

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


def _organization_id():
    context = get_current_tenant()
    if context is None:
        raise HTTPException(409, "No se pudo identificar el negocio actual")
    return context.organization_id


async def _evolution_response(result: evolution_service.EvolutionConnection) -> dict:
    return {
        "state": result.state,
        "instance": result.instance,
        "qr_base64": result.qr_base64,
        "pairing_code": result.pairing_code,
        "webhook_configured": await evolution_service.webhook_configured(),
    }


async def _sync_evolution_route(organization_id, result: evolution_service.EvolutionConnection) -> None:
    """Mantiene el ruteo de webhooks a tono con la instancia real.

    Se registra recién cuando la sesión está abierta: antes no hay eventos que
    recibir. Al desconectarse se desactiva para que un evento rezagado no cree
    conversaciones en un número que ya no pertenece al negocio.
    """
    if result.state == "open" and result.instance:
        await sync_whatsapp_connection(
            organization_id,
            phone_number_id=result.instance,
            provider="evolution",
        )
        # Reaplica la configuración por si el operador cargó el webhook después
        # de vincular. Es best-effort: la conexión sigue válida sin webhook.
        try:
            await evolution_service.configure_webhook(result.instance)
        except (ChannelError, httpx.HTTPError) as exc:
            logger.warning("No se pudo configurar el webhook de Evolution: %s", exc)
        return
    if result.state in {"missing", "close"}:
        for name in {
            evolution_service.instance_name(organization_id),
            evolution_service.legacy_instance_name(organization_id),
        }:
            await disable_whatsapp_connection(
                organization_id, provider="evolution", phone_number_id=name
            )


@router.get("/evolution/status", response_model=EvolutionStatusItem)
async def evolution_status():
    organization_id = _organization_id()
    try:
        result = await evolution_service.connection_status(organization_id)
    except (ChannelError, httpx.HTTPError) as exc:
        logger.warning("No se pudo consultar Evolution: %s", exc)
        raise HTTPException(502, str(exc)) from exc
    await _sync_evolution_route(organization_id, result)
    return await _evolution_response(result)


@router.post("/evolution/connect", response_model=EvolutionStatusItem)
async def evolution_connect(body: EvolutionConnectRequest):
    organization_id = _organization_id()
    try:
        result = await evolution_service.connect(organization_id, body.phone_number)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from exc
    except (ChannelError, httpx.HTTPError) as exc:
        logger.warning("No se pudo conectar Evolution: %s", exc)
        raise HTTPException(502, str(exc)) from exc
    await _sync_evolution_route(organization_id, result)
    return await _evolution_response(result)


@router.delete("/evolution", response_model=EvolutionStatusItem)
async def evolution_remove():
    organization_id = _organization_id()
    try:
        result = await evolution_service.remove(organization_id)
    except (ChannelError, httpx.HTTPError) as exc:
        logger.warning("No se pudo eliminar la conexión Evolution: %s", exc)
        raise HTTPException(502, str(exc)) from exc
    await _sync_evolution_route(organization_id, result)
    return await _evolution_response(result)


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
