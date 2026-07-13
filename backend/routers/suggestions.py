from fastapi import APIRouter, HTTPException
from db.models import LeadStage as DbLeadStage
from models.schemas import SuggestionRequest, SuggestionResponse
from services.db_service import cache_suggestion, get_cached_suggestion, update_lead_stage
from services.n8n_service import call_n8n
from services.ws_manager import manager

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

    # El Structured Output Parser del workflow obliga al agente a devolver
    # `output.estado`. Esa decisión es la única fuente de verdad: se persiste
    # al terminar la ejecución y luego se avisa a todos los paneles abiertos.
    lead = await update_lead_stage(body.chat_id, DbLeadStage(result.estado))
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead no encontrado")

    await cache_suggestion(body.chat_id, result.model_dump())

    await manager.broadcast(
        {
            "type": "chats_updated",
            "lead_stage_updated": {
                "chat_id": body.chat_id,
                "stage": result.estado,
            },
        }
    )
    return result
