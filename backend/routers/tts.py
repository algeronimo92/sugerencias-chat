import base64

from fastapi import APIRouter, HTTPException
from models.schemas import TtsRequest, TtsResponse
from services.tts_service import TtsError, synthesize_speech

router = APIRouter(prefix="/api/tts", tags=["tts"])


@router.post("", response_model=TtsResponse)
async def generate_speech(body: TtsRequest):
    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="El texto no puede estar vacío")

    try:
        audio_bytes = await synthesize_speech(text)
    except TtsError as e:
        raise HTTPException(status_code=502, detail=str(e))

    return TtsResponse(
        content_type="audio/mpeg",
        data_base64=base64.b64encode(audio_bytes).decode("ascii"),
    )
