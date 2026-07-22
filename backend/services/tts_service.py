import httpx
from time import perf_counter
from services.performance import record_external_duration
from services.settings_service import get_effective_many

ELEVENLABS_BASE_URL = "https://api.elevenlabs.io"
MAX_TEXT_LENGTH = 5000  # ElevenLabs no documenta un límite fijo; este es un tope defensivo razonable para una nota de voz.


class TtsError(Exception):
    pass


_http_client: httpx.AsyncClient | None = None


def _client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(timeout=60.0)
    return _http_client


async def close_tts_client() -> None:
    global _http_client
    if _http_client is not None:
        await _http_client.aclose()
        _http_client = None


async def synthesize_speech(text: str) -> bytes:
    """Genera un audio MP3 a partir de texto usando la API de ElevenLabs."""
    values = await get_effective_many((
        "elevenlabs_api_key", "elevenlabs_voice_id", "elevenlabs_model_id",
        "elevenlabs_stability", "elevenlabs_style", "elevenlabs_speed",
        "elevenlabs_use_speaker_boost",
    ))
    api_key = values["elevenlabs_api_key"]
    voice_id = values["elevenlabs_voice_id"]
    if not api_key or not voice_id:
        raise TtsError("ElevenLabs no está configurado (falta la API key o el ID de voz)")

    if len(text) > MAX_TEXT_LENGTH:
        raise TtsError(f"El texto supera el máximo de {MAX_TEXT_LENGTH} caracteres")

    url = f"{ELEVENLABS_BASE_URL}/v1/text-to-speech/{voice_id}"
    payload = {
        "text": text,
        "model_id": values["elevenlabs_model_id"],
        "voice_settings": {
            "stability": float(values["elevenlabs_stability"]),
            "style": float(values["elevenlabs_style"]),
            "speed": float(values["elevenlabs_speed"]),
            "use_speaker_boost": values["elevenlabs_use_speaker_boost"].lower() == "true",
        },
    }
    headers = {"xi-api-key": api_key}

    # output_format por default (mp3_44100_128) — mismo formato que ya
    # maneja el resto del flujo de envío de audio (Evolution API, preview).
    started_at = perf_counter()
    try:
        response = await _client().post(url, json=payload, headers=headers)
    finally:
        record_external_duration("elevenlabs", (perf_counter() - started_at) * 1000)
    if response.is_error:
        raise TtsError(f"ElevenLabs respondió {response.status_code}: {response.text}")
    return response.content
