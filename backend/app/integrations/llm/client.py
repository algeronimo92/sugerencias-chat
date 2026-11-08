from __future__ import annotations

from app.integrations.llm.base import LlmClient
from app.integrations.llm.catalog import effective_params, parse_model_spec, resolve_model_spec
from app.integrations.llm.gemini import GeminiClient
from app.integrations.llm.openai import OpenAiClient


def build_client(spec: str, api_key: str, overrides: dict | None = None) -> LlmClient:
    """``proveedor:modelo`` + clave + lo que el negocio sobrescribió → cliente
    listo, con los parámetros efectivos de ese modelo (defaults del registro
    más las sobrescrituras que aplican). Un modelo retirado se construye con su
    reemplazo. Falla con ``ValueError`` si el modelo no está en el catálogo."""
    resolved = resolve_model_spec(spec)
    provider, model = parse_model_spec(resolved)
    params = effective_params(resolved, overrides)
    if provider == "gemini":
        return GeminiClient(api_key, model, params)
    return OpenAiClient(api_key, model, params)
