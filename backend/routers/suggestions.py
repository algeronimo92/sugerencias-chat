from fastapi import APIRouter, HTTPException
from models.schemas import SuggestionRequest, SuggestionResponse
from services.n8n_service import call_n8n

router = APIRouter(prefix="/api/suggestions", tags=["suggestions"])


@router.post("", response_model=SuggestionResponse)
async def get_suggestions(body: SuggestionRequest):
    try:
        result = await call_n8n(body.chat_id, body.phone)
        return result
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Error llamando n8n: {str(e)}")
