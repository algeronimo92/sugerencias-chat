import httpx
from config import settings


class EvolutionApiError(Exception):
    pass


def _require_config() -> None:
    if not (settings.evolution_api_url and settings.evolution_api_key and settings.evolution_instance):
        raise EvolutionApiError(
            "Evolution API no está configurada (EVOLUTION_API_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE)"
        )


async def _post(url: str, payload: dict, timeout: float) -> dict:
    """POST a Evolution API. Si responde con error, la excepción incluye el
    body de la respuesta (no solo el status code) — sin esto, un 400 por un
    payload mal formado es indistinguible de cualquier otro error y hay que
    ir a probar con curl a mano para saber qué se quejó realmente."""
    headers = {"apikey": settings.evolution_api_key}
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, json=payload, headers=headers)
        if response.is_error:
            raise EvolutionApiError(f"Evolution API respondió {response.status_code}: {response.text}")
        return response.json()


async def send_whatsapp_text(chat_id: str, text: str) -> dict:
    _require_config()

    url = f"{settings.evolution_api_url.rstrip('/')}/message/sendText/{settings.evolution_instance}"
    # chat_id ya es el remoteJid completo (ej. 5491112345678@s.whatsapp.net);
    # Evolution API v2 acepta ese formato directo en "number".
    payload = {"number": chat_id, "text": text}
    return await _post(url, payload, timeout=30.0)


async def send_whatsapp_audio(chat_id: str, audio_base64: str) -> dict:
    """Manda una nota de voz (PTT) — endpoint específico de Evolution API,
    distinto de mandar un audio como adjunto genérico."""
    _require_config()

    url = f"{settings.evolution_api_url.rstrip('/')}/message/sendWhatsAppAudio/{settings.evolution_instance}"
    payload = {"number": chat_id, "audio": audio_base64}
    return await _post(url, payload, timeout=60.0)


async def send_whatsapp_location(
    chat_id: str,
    latitude: float,
    longitude: float,
    name: str | None = None,
    address: str | None = None,
) -> dict:
    """name/address están documentados como opcionales en Evolution API,
    pero en la práctica el servidor los exige igual (400 "instance requires
    property name/address" si se omiten) — siempre van con algún valor."""
    _require_config()

    url = f"{settings.evolution_api_url.rstrip('/')}/message/sendLocation/{settings.evolution_instance}"
    payload = {
        "number": chat_id,
        "latitude": latitude,
        "longitude": longitude,
        "name": name or "Ubicación compartida",
        "address": address or f"{latitude}, {longitude}",
    }
    return await _post(url, payload, timeout=30.0)


async def send_whatsapp_media(
    chat_id: str, media_base64: str, mediatype: str, filename: str | None = None
) -> dict:
    """Manda un adjunto genérico (imagen, video, audio como archivo, o
    documento). mediatype le dice a Evolution API cómo procesarlo —
    distinto de sendWhatsAppAudio, que siempre es nota de voz (PTT).
    filename es el nombre original elegido por el usuario: importa sobre
    todo para documentos, para que el destinatario vea el nombre real."""
    _require_config()

    url = f"{settings.evolution_api_url.rstrip('/')}/message/sendMedia/{settings.evolution_instance}"
    payload = {"number": chat_id, "mediatype": mediatype, "media": media_base64}
    if filename:
        payload["fileName"] = filename
    return await _post(url, payload, timeout=60.0)
