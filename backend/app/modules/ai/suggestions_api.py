"""Contrato HTTP del asistente IA del vendedor. Los casos de uso viven en
application/assistant.py y sus errores los traduce bootstrap."""

from fastapi import APIRouter

from app.modules.ai.ai_access import usage_summary
from app.modules.ai.application.assistant import LeadNotFound, analyze_lead, suggest_reply
from app.modules.ai.schemas import AIUsage, AnalysisRequest, LeadAnalysisResult, SuggestionRequest, SuggestionResponse, SuggestionStatus
from app.modules.ai.suggestions_service import get_suggestion_status

router = APIRouter(prefix="/api/suggestions", tags=["suggestions"])


@router.get("/usage", response_model=AIUsage)
async def read_ai_usage():
    """Si el asistente está habilitado y cuánto queda de la cuota del mes."""
    return await usage_summary()


@router.post("/analyze", response_model=LeadAnalysisResult)
async def analyze_lead_on_demand(body: AnalysisRequest):
    """Run the analyst only after an authenticated user asks for it."""
    return await analyze_lead(body.chat_id)


@router.get("/{chat_id}", response_model=SuggestionStatus)
async def read_suggestion_status(chat_id: str):
    """Lectura barata de la sugerencia guardada: nunca genera contenido nuevo.
    El frontend la usa al abrir un chat (mostrar lo ya generado es gratis) y
    al llegar un mensaje del cliente (solo para marcarla como desactualizada)."""
    status = await get_suggestion_status(chat_id)
    if status is None:
        raise LeadNotFound()
    return SuggestionStatus(**status)


@router.post("", response_model=SuggestionResponse)
async def get_suggestions(body: SuggestionRequest):
    result = await suggest_reply(body.chat_id, body.phone, force=body.force, instruction=body.instruction)
    return SuggestionResponse(**result) if isinstance(result, dict) else result
