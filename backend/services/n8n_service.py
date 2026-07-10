import asyncio
import json
import logging

import httpx
from models.schemas import SuggestionResponse
from services.settings_service import get_effective

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 1.5


async def call_n8n(chat_id: str, phone: str | None) -> SuggestionResponse:
    webhook_url = await get_effective("n8n_webhook_url")
    webhook_token = await get_effective("n8n_webhook_token")
    if not webhook_url:
        raise RuntimeError("n8n no está configurado (falta la URL del webhook)")

    headers = {}
    if webhook_token:
        headers["Authorization"] = f"Bearer {webhook_token}"

    last_error: Exception = RuntimeError("call_n8n: sin intentos")
    async with httpx.AsyncClient(timeout=30.0) as client:
        for attempt in range(1, MAX_ATTEMPTS + 1):
            response = await client.get(
                webhook_url,
                params={"chat_id": chat_id},
                headers=headers,
            )
            response.raise_for_status()
            try:
                # n8n devuelve un array: [{"output": {...}}]
                data = response.json()
                output = data[0]["output"]
                return SuggestionResponse(**output)
            except (json.JSONDecodeError, IndexError, KeyError) as e:
                # El nodo Webhook de n8n procesa una ejecución a la vez por
                # URL: si esta petición llega mientras otra ejecución del
                # mismo workflow sigue en curso, puede devolver el body
                # vacío en vez de encolarla. Se reintenta antes de fallar.
                last_error = e
                logger.warning(
                    "call_n8n: respuesta inválida de n8n (intento %d/%d): %r",
                    attempt,
                    MAX_ATTEMPTS,
                    e,
                )
                if attempt < MAX_ATTEMPTS:
                    await asyncio.sleep(RETRY_DELAY_SECONDS)

    raise last_error
