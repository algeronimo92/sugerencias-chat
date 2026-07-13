import httpx
from services.settings_service import get_effective

ELEVENLABS_BASE_URL = "https://api.elevenlabs.io"
MAX_TEXT_LENGTH = 5000  # ElevenLabs no documenta un límite fijo; este es un tope defensivo razonable para una nota de voz.


class TtsError(Exception):
    pass


async def synthesize_speech(text: str) -> bytes:
    """Genera un audio MP3 a partir de texto usando la API de ElevenLabs."""
    api_key = await get_effective("elevenlabs_api_key")
    voice_id = await get_effective("elevenlabs_voice_id")
    if not api_key or not voice_id:
        raise TtsError("ElevenLabs no está configurado (falta la API key o el ID de voz)")

    if len(text) > MAX_TEXT_LENGTH:
        raise TtsError(f"El texto supera el máximo de {MAX_TEXT_LENGTH} caracteres")

    url = f"{ELEVENLABS_BASE_URL}/v1/text-to-speech/{voice_id}"
    payload = {
        "text": text,
        "model_id": await get_effective("elevenlabs_model_id"),
        "voice_settings": {
            "stability": float(await get_effective("elevenlabs_stability")),
            "style": float(await get_effective("elevenlabs_style")),
            "speed": float(await get_effective("elevenlabs_speed")),
            "use_speaker_boost": (await get_effective("elevenlabs_use_speaker_boost")).lower() == "true",
        },
    }
    headers = {"xi-api-key": api_key}

    async with httpx.AsyncClient(timeout=60.0) as client:
        # output_format por default (mp3_44100_128) — mismo formato que ya
        # maneja el resto del flujo de envío de audio (Evolution API, preview
        # en el frontend).
        response = await client.post(url, json=payload, headers=headers)
        if response.is_error:
            raise TtsError(f"ElevenLabs respondió {response.status_code}: {response.text}")
        return response.content
