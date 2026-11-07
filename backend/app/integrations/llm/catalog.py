"""Qué proveedores y modelos puede elegir un negocio. Lista cerrada a propósito:
un modelo que no está acá no se puede guardar, así la prueba de conexión y el
costo son predecibles. Ampliar es sumar una línea."""

from __future__ import annotations

PROVIDERS: dict[str, dict] = {
    "gemini": {
        "label": "Google Gemini",
        "key_setting": "ai_gemini_api_key",
        "models": ["gemini-2.5-flash", "gemini-2.5-pro", "gemini-2.0-flash"],
    },
    "openai": {
        "label": "OpenAI",
        "key_setting": "ai_openai_api_key",
        "models": ["gpt-5.6-terra", "gpt-5.5", "gpt-5-mini", "gpt-4.1-mini"],
    },
}

# Lo mismo que corre hoy en el agente de n8n: Gemini responde y OpenAI respalda.
DEFAULT_PRIMARY = "gemini:gemini-2.5-flash"
DEFAULT_FALLBACK = "openai:gpt-5.6-terra"


def parse_model_spec(spec: str) -> tuple[str, str]:
    """``proveedor:modelo`` validado contra el catálogo."""
    provider, _, model = (spec or "").strip().partition(":")
    if provider not in PROVIDERS:
        raise ValueError(f"Proveedor de IA desconocido: {provider or '(vacío)'}")
    if model not in PROVIDERS[provider]["models"]:
        raise ValueError(f"Modelo no disponible para {PROVIDERS[provider]['label']}: {model or '(vacío)'}")
    return provider, model


def key_setting_for(provider: str) -> str:
    return PROVIDERS[provider]["key_setting"]
