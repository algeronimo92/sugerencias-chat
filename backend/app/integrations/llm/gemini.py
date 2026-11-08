"""Google Gemini (Generative Language API, v1beta) con ``responseSchema``."""

from __future__ import annotations

import httpx

from app.integrations.llm.base import LlmError, LlmRequest, LlmResult

BASE_URL = "https://generativelanguage.googleapis.com/v1beta"
TIMEOUT_SECONDS = 60.0

# Filtros apagados, explícito: el nodo de n8n tuvo que relajarlos porque
# Gemini devolvía vacío ante conversaciones legítimas de una clínica
# (lactancia, depilación íntima, anticoagulantes). En los 3.x el default ya es
# OFF; mandarlo igual evita depender de que Google no cambie ese default.
SAFETY_SETTINGS = [
    {"category": category, "threshold": "OFF"}
    for category in (
        "HARM_CATEGORY_HARASSMENT",
        "HARM_CATEGORY_HATE_SPEECH",
        "HARM_CATEGORY_SEXUALLY_EXPLICIT",
        "HARM_CATEGORY_DANGEROUS_CONTENT",
    )
]
# Motivos de corte que dejan la respuesta incompleta o vacía.
_BLOCKED = {"SAFETY", "RECITATION", "BLOCKLIST", "PROHIBITED_CONTENT", "SPII", "OTHER"}


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
        candidates = payload.get("candidates") or []
        if not candidates:
            reason = (payload.get("promptFeedback") or {}).get("blockReason") or "sin candidatos"
            raise LlmError(f"Gemini no devolvió texto ({reason})")
        candidate = candidates[0]
        finish = candidate.get("finishReason")
        if finish == "MAX_TOKENS":
            raise LlmError(f"Gemini cortó la respuesta por longitud ({self.model})")
        if finish in _BLOCKED:
            raise LlmError(f"Gemini bloqueó la respuesta ({finish})")
        try:
            text = "".join(part.get("text", "") for part in candidate["content"]["parts"])
        except (KeyError, TypeError):
            raise LlmError(f"Gemini no devolvió texto ({finish or 'sin contenido'})")
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
            "safetySettings": SAFETY_SETTINGS,
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": to_gemini_schema(request.schema),
                "maxOutputTokens": request.max_output_tokens,
            },
        })

    async def ping(self) -> LlmResult:
        return await self._generate({
            "contents": [{"role": "user", "parts": [{"text": "Responde únicamente con la palabra OK."}]}],
            "generationConfig": {"maxOutputTokens": 300},
        })

    async def list_models(self) -> set[str]:
        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                response = await client.get(
                    f"{BASE_URL}/models", params={"pageSize": 1000}, headers={"x-goog-api-key": self._api_key},
                )
        except httpx.HTTPError as exc:
            raise LlmError(f"No se pudo conectar con Gemini: {exc}") from exc
        if response.status_code >= 400:
            raise LlmError(
                f"Gemini respondió {response.status_code}: {_error_detail(response)}",
                status=response.status_code, retryable=response.status_code >= 500,
            )
        return {
            item["name"].removeprefix("models/")
            for item in response.json().get("models", [])
            if "generateContent" in item.get("supportedGenerationMethods", [])
        }


def _error_detail(response: httpx.Response) -> str:
    try:
        return str((response.json().get("error") or {}).get("message") or response.text[:200])
    except ValueError:
        return response.text[:200]
