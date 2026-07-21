from fastapi import APIRouter, HTTPException
from db.models import LeadStage as DbLeadStage
from models.schemas import SuggestionRequest, SuggestionResponse
from services.db_service import cache_suggestion, fetch_chat, get_cached_suggestion, update_lead_stage
from services.n8n_service import call_n8n
from services.ws_manager import manager
from services.automation_service import trigger_stage_changed

import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/suggestions", tags=["suggestions"])


@router.post("", response_model=SuggestionResponse)
async def get_suggestions(body: SuggestionRequest):
    cached = await get_cached_suggestion(body.chat_id)
    if cached is not None:
        return SuggestionResponse(**cached)

    try:
        result = await call_n8n(body.chat_id, body.phone)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error llamando n8n: {str(e)}")

    # Si el workflow manda `output.estado`, esa decisión es la única fuente
    # de verdad para la etapa: se persiste al terminar la ejecución y luego
    # se avisa a todos los paneles abiertos. El workflow actual ya no lo
    # incluye siempre (ver senal_compra/alerta en SuggestionResponse), así
    # que si no viene no se toca la etapa del lead.
    previous = await fetch_chat(body.chat_id)
    if previous is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")
    if result.estado is not None:
        await update_lead_stage(
            body.chat_id,
            DbLeadStage(result.estado),
            actor_type="agent",
            metadata={"confidence": result.confianza, "reason": result.analisis},
        )

    await cache_suggestion(body.chat_id, result.model_dump())

    if result.estado is not None:
        await manager.broadcast(
            {
                "type": "chats_updated",
                "lead_stage_updated": {
                    "chat_id": body.chat_id,
                    "stage": result.estado,
                },
            }
        )
        if previous and previous["stage"] != result.estado:
            try:
                await trigger_stage_changed(body.chat_id)
            except Exception:
                logger.exception("No se pudo programar la automatización de cambio de etapa del agente")
    return result
