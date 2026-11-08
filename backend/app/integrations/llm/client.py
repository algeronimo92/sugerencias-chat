from __future__ import annotations

from app.integrations.llm.base import LlmClient
from app.integrations.llm.catalog import model_options, parse_model_spec, resolve_model_spec
from app.integrations.llm.gemini import GeminiClient
from app.integrations.llm.openai import OpenAiClient


def build_client(spec: str, api_key: str) -> LlmClient:
    """``proveedor:modelo`` + clave → cliente listo, con los parámetros que ese
    modelo acepta. Un modelo retirado se construye con su reemplazo. Falla con
    ``ValueError`` si el modelo no está en el catálogo."""
    resolved = resolve_model_spec(spec)
    provider, model = parse_model_spec(resolved)
    if provider == "gemini":
        return GeminiClient(api_key, model)
    return OpenAiClient(api_key, model, **model_options(resolved))
