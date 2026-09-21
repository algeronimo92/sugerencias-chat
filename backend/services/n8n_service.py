import asyncio
import json
import logging
from time import perf_counter

import httpx
from models.schemas import SuggestionResponse
from request_metrics import record_external_duration
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


async def post_form(url: str, data: dict, files: dict | None, timeout: float) -> httpx.Response:
    """Envía un formulario multipart a un webhook de n8n con el cliente
    compartido del proceso, en vez de abrir uno nuevo por request."""
    started_at = perf_counter()
    try:
        return await _client().post(url, data=data, files=files, timeout=timeout)
    finally:
        record_external_duration("n8n", (perf_counter() - started_at) * 1000)


async def call_n8n(
    chat_id: str,
    phone: str | None,
    refresh: bool = False,
    instruction: str | None = None,
    *,
    operation: str = "rag",
    job_id: str | None = None,
    context_revision: str | None = None,
    tenant_context_token: str | None = None,
) -> SuggestionResponse:
    values = await get_effective_many(("n8n_webhook_url", "n8n_webhook_token"))
    webhook_url = values["n8n_webhook_url"]
    webhook_token = values["n8n_webhook_token"]
    if not webhook_url:
        raise RuntimeError("n8n no está configurado (falta la URL del webhook)")

    headers = {}
    if webhook_token:
        headers["Authorization"] = f"Bearer {webhook_token}"
    if job_id:
        headers["X-Job-Id"] = job_id
    if tenant_context_token:
        headers["X-Tenant-Context"] = tenant_context_token

    # `refresh` marca los reintentos pedidos a mano por el vendedor: el
    # workflow puede usarlo para subir la temperatura del modelo o pedirle
    # alternativas distintas. Si lo ignora, la llamada funciona igual.
    params = {"chat_id": chat_id, "operation": operation}
    if job_id:
        params["job_id"] = job_id
    if context_revision:
        params["context_revision"] = context_revision
    if refresh:
        params["refresh"] = "true"
    # Indicación del asesor ("dar precio", "no dar precio", contexto del
    # cliente). El workflow la inyecta en el prompt como sección de alta
    # prioridad — "Instrucción del asesor", por encima de las reglas
    # generales — para que pese en el resultado. Llega saneada y acotada
    # (ver SuggestionRequest.instruction).
    if instruction:
        params["instruction"] = instruction

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


async def call_n8n_analyst(
    chat_id: str,
    *,
    job_id: str,
    context_revision: str,
    tenant_context_token: str,
) -> dict:
    """Dispatch a synchronous, on-demand analyst job.

    The workflow must apply its result through the scoped callback before it
    responds. Its response is informational; the persisted AIJob is the source
    of truth for the outcome.
    """

    values = await get_effective_many(
        ("n8n_analyst_webhook_url", "n8n_webhook_token")
    )
    webhook_url = values["n8n_analyst_webhook_url"]
    if not webhook_url:
        raise RuntimeError("n8n analyst workflow is not configured")
    headers = {
        "X-Job-Id": job_id,
        "X-Tenant-Context": tenant_context_token,
    }
    if values["n8n_webhook_token"]:
        headers["Authorization"] = f"Bearer {values['n8n_webhook_token']}"
    started_at = perf_counter()
    try:
        response = await _client().get(
            webhook_url,
            params={
                "operation": "analyst",
                "chat_id": chat_id,
                "job_id": job_id,
                "context_revision": context_revision,
            },
            headers=headers,
            # The workflow debounces before invoking the model, so the shared
            # 30 second client timeout is too short for this synchronous path.
            timeout=120.0,
        )
    finally:
        record_external_duration("n8n", (perf_counter() - started_at) * 1000)
    response.raise_for_status()
    try:
        data = response.json()
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {"output": data}
