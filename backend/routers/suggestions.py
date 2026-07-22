from fastapi import APIRouter, HTTPException
from db.models import LeadStage as DbLeadStage
from models.schemas import SuggestionRequest, SuggestionResponse
from services.db_service import cache_suggestion, get_cached_suggestion, update_lead_stage
from services.n8n_service import call_n8n
from services.ws_manager import manager
from services.automation_service import trigger_stage_changed

import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/suggestions", tags=["suggestions"])


@router.post("", response_model=SuggestionResponse)
async def get_suggestions(body: SuggestionRequest):
    if not body.force:
        cached = await get_cached_suggestion(body.chat_id)
        if cached is not None:
            return SuggestionResponse(**cached)

    try:
        result = await call_n8n(body.chat_id, body.phone, refresh=body.force)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error llamando n8n: {str(e)}")

    # Si el workflow manda `output.estado`, esa decisión es la única fuente
    # de verdad para la etapa: se persiste al terminar la ejecución y luego
    # se avisa a todos los paneles abiertos. El workflow actual ya no lo
    # incluye siempre (ver senal_compra/alerta en SuggestionResponse), así
    # que si no viene no se toca la etapa del lead.
    stage_update = None
    if result.estado is not None:
        stage_update = await update_lead_stage(
            body.chat_id,
            DbLeadStage(result.estado),
            actor_type="agent",
            metadata={"confidence": result.confianza, "reason": result.analisis},
            include_chat=False,
        )
        if stage_update is None:
            raise HTTPException(status_code=404, detail="Lead no encontrado")

    if not await cache_suggestion(body.chat_id, result.model_dump()):
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    if result.estado is not None:
        await manager.broadcast(
            {
                "type": "chats_updated",
                "chat_id": body.chat_id,
                "reason": "stage_changed",
                "lead_stage_updated": {
                    "chat_id": body.chat_id,
                    "stage": result.estado,
                },
            }
        )
        if stage_update and stage_update["changed"]:
            try:
                await trigger_stage_changed(body.chat_id)
            except Exception:
                logger.exception("No se pudo programar la automatización de cambio de etapa del agente")
    return result
