"""Google Gemini (Generative Language API, v1beta) con ``responseSchema``."""

from __future__ import annotations

import httpx

from app.integrations.llm.base import LlmError, LlmRequest, LlmResult

BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
TIMEOUT_SECONDS = 60.0


def to_gemini_schema(schema: dict) -> dict:
    """Gemini acepta un subconjunto de OpenAPI: tipos en mayúsculas,
    ``nullable`` en vez de ``["string", "null"]`` y sin
    ``additionalProperties``. Se recorre el esquema y se traduce."""
    out: dict = {}
    type_ = schema.get("type")
    if isinstance(type_, list):
        non_null = [t for t in type_ if t != "null"]
        out["type"] = (non_null[0] if non_null else "string").upper()
        if "null" in type_:
            out["nullable"] = True
    elif isinstance(type_, str):
        out["type"] = type_.upper()
    for key in ("description", "enum", "required", "maxItems", "minItems", "format"):
        if key in schema:
            out[key] = schema[key]
    if "properties" in schema:
        out["properties"] = {name: to_gemini_schema(value) for name, value in schema["properties"].items()}
        # El orden de las claves en la salida sigue al del esquema.
        out["propertyOrdering"] = list(schema["properties"].keys())
    if "items" in schema:
        out["items"] = to_gemini_schema(schema["items"])
    return out


class GeminiClient:
    provider = "gemini"

    def __init__(self, api_key: str, model: str) -> None:
        self._api_key = api_key
        self.model = model

    async def _generate(self, body: dict) -> LlmResult:
        url = f"{BASE_URL}/models/{self.model}:generateContent"
        try:
            async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
                response = await client.post(url, json=body, headers={"x-goog-api-key": self._api_key})
        except httpx.HTTPError as exc:
            raise LlmError(f"No se pudo conectar con Gemini: {exc}") from exc
        if response.status_code >= 400:
            detail = _error_detail(response)
            raise LlmError(
                f"Gemini respondió {response.status_code}: {detail}",
                status=response.status_code,
                retryable=response.status_code not in (400, 401, 403, 404),
            )
        payload = response.json()
        try:
            candidate = payload["candidates"][0]
            text = "".join(part.get("text", "") for part in candidate["content"]["parts"])
        except (KeyError, IndexError, TypeError):
            reason = (payload.get("promptFeedback") or {}).get("blockReason") or "sin candidatos"
            raise LlmError(f"Gemini no devolvió texto ({reason})")
        usage = payload.get("usageMetadata") or {}
        return LlmResult(
            text=text,
            model=self.model,
            tokens_in=usage.get("promptTokenCount"),
            tokens_out=usage.get("candidatesTokenCount"),
            extra={"finish_reason": candidate.get("finishReason")},
        )

    async def complete_json(self, request: LlmRequest) -> LlmResult:
        return await self._generate({
            "system_instruction": {"parts": [{"text": request.system}]},
            "contents": [{"role": "user", "parts": [{"text": request.user}]}],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": to_gemini_schema(request.schema),
                "maxOutputTokens": request.max_output_tokens,
            },
        })

    async def ping(self) -> LlmResult:
        return await self._generate({
            "contents": [{"role": "user", "parts": [{"text": "Responde únicamente con la palabra OK."}]}],
            "generationConfig": {"maxOutputTokens": 50},
        })


def _error_detail(response: httpx.Response) -> str:
    try:
        return str((response.json().get("error") or {}).get("message") or response.text[:200])
    except ValueError:
        return response.text[:200]
