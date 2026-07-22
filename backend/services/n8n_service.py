import asyncio
import json
import logging
from time import perf_counter

import httpx
from models.schemas import SuggestionResponse
from services.performance import record_external_duration
from services.settings_service import get_effective_many

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
RETRY_DELAY_SECONDS = 1.5
_http_client: httpx.AsyncClient | None = None


def _client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=30.0,
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _http_client


async def close_n8n_client() -> None:
    global _http_client
    if _http_client is not None:
        await _http_client.aclose()
        _http_client = None


async def call_n8n(chat_id: str, phone: str | None, refresh: bool = False) -> SuggestionResponse:
    values = await get_effective_many(("n8n_webhook_url", "n8n_webhook_token"))
    webhook_url = values["n8n_webhook_url"]
    webhook_token = values["n8n_webhook_token"]
    if not webhook_url:
        raise RuntimeError("n8n no está configurado (falta la URL del webhook)")

    headers = {}
    if webhook_token:
        headers["Authorization"] = f"Bearer {webhook_token}"

    # `refresh` marca los reintentos pedidos a mano por el vendedor: el
    # workflow puede usarlo para subir la temperatura del modelo o pedirle
    # alternativas distintas. Si lo ignora, la llamada funciona igual.
    params = {"chat_id": chat_id}
    if refresh:
        params["refresh"] = "true"

    last_error: Exception = RuntimeError("call_n8n: sin intentos")
    for attempt in range(1, MAX_ATTEMPTS + 1):
        started_at = perf_counter()
        try:
            response = await _client().get(
                webhook_url,
                params=params,
                headers=headers,
            )
        finally:
            record_external_duration("n8n", (perf_counter() - started_at) * 1000)
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
