import httpx
from config import settings


class EvolutionApiError(Exception):
    pass


async def send_whatsapp_text(chat_id: str, text: str) -> dict:
    if not (settings.evolution_api_url and settings.evolution_api_key and settings.evolution_instance):
        raise EvolutionApiError(
            "Evolution API no está configurada (EVOLUTION_API_URL / EVOLUTION_API_KEY / EVOLUTION_INSTANCE)"
        )

    url = f"{settings.evolution_api_url.rstrip('/')}/message/sendText/{settings.evolution_instance}"
    headers = {"apikey": settings.evolution_api_key}
    # chat_id ya es el remoteJid completo (ej. 5491112345678@s.whatsapp.net);
    # Evolution API v2 acepta ese formato directo en "number".
    payload = {"number": chat_id, "text": text}

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(url, json=payload, headers=headers)
        response.raise_for_status()
        return response.json()
