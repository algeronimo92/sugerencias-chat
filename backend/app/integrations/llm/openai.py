"""OpenAI (Chat Completions) con ``response_format`` de esquema estricto."""

from __future__ import annotations

import httpx

from app.integrations.llm.base import LlmError, LlmRequest, LlmResult

BASE_URL = "https://api.openai.com/v1"
TIMEOUT_SECONDS = 60.0


class OpenAiClient:
    provider = "openai"

    def __init__(self, api_key: str, model: str) -> None:
        self._api_key = api_key
        self.model = model

    async def _complete(self, body: dict) -> LlmResult:
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
                response = await client.post(
                    f"{BASE_URL}/chat/completions",
                    json={"model": self.model, **body},
                    headers={"Authorization": f"Bearer {self._api_key}"},
                )
        except httpx.HTTPError as exc:
            raise LlmError(f"No se pudo conectar con OpenAI: {exc}") from exc
        if response.status_code >= 400:
            detail = _error_detail(response)
            raise LlmError(
                f"OpenAI respondió {response.status_code}: {detail}",
                status=response.status_code,
                retryable=response.status_code not in (400, 401, 403, 404),
            )
        payload = response.json()
        try:
            choice = payload["choices"][0]
            text = choice["message"]["content"] or ""
        except (KeyError, IndexError, TypeError):
            raise LlmError("OpenAI no devolvió contenido")
        if choice.get("message", {}).get("refusal"):
            raise LlmError(f"OpenAI rechazó el pedido: {choice['message']['refusal']}", retryable=False)
        usage = payload.get("usage") or {}
        return LlmResult(
            text=text,
            model=payload.get("model") or self.model,
            tokens_in=usage.get("prompt_tokens"),
            tokens_out=usage.get("completion_tokens"),
            extra={"finish_reason": choice.get("finish_reason")},
        )

    async def complete_json(self, request: LlmRequest) -> LlmResult:
        # Sin ``temperature``: los modelos con razonamiento la rechazan.
        return await self._complete({
            "messages": [
                {"role": "system", "content": request.system},
                {"role": "user", "content": request.user},
            ],
            "response_format": {
                "type": "json_schema",
                "json_schema": {"name": request.schema_name, "strict": True, "schema": request.schema},
            },
            "max_completion_tokens": request.max_output_tokens,
        })

    async def ping(self) -> LlmResult:
        return await self._complete({
            "messages": [{"role": "user", "content": "Responde únicamente con la palabra OK."}],
            "max_completion_tokens": 50,
        })


def _error_detail(response: httpx.Response) -> str:
    try:
        return str((response.json().get("error") or {}).get("message") or response.text[:200])
    except ValueError:
        return response.text[:200]
