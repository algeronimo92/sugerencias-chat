import httpx
from services.settings_service import get_effective

OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech"
MAX_TEXT_LENGTH = 4096  # límite de OpenAI para /audio/speech


class TtsError(Exception):
    pass


async def synthesize_speech(text: str) -> bytes:
    """Genera un audio MP3 a partir de texto usando la API de OpenAI TTS."""
    api_key = await get_effective("openai_api_key")
    if not api_key:
        raise TtsError("OpenAI no está configurado (falta la API key)")

    if len(text) > MAX_TEXT_LENGTH:
        raise TtsError(f"El texto supera el máximo de {MAX_TEXT_LENGTH} caracteres")

    payload = {
        "model": await get_effective("openai_tts_model"),
        "voice": await get_effective("openai_tts_voice"),
        "input": text,
        "response_format": "mp3",
    }
    headers = {"Authorization": f"Bearer {api_key}"}

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(OPENAI_TTS_URL, json=payload, headers=headers)
        if response.is_error:
            raise TtsError(f"OpenAI TTS respondió {response.status_code}: {response.text}")
        return response.content
