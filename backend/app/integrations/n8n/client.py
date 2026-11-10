import json
import logging
from time import perf_counter

import httpx
from app.core.request_metrics import record_external_duration
from app.modules.platform.public import platform_settings_many

logger = logging.getLogger(__name__)

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

    values = await platform_settings_many(
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
