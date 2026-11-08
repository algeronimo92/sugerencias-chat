"""Qué proveedores y modelos puede elegir un negocio, y cómo hablarle a cada uno.

Lista cerrada a propósito: un modelo que no está acá no se puede guardar, así
la prueba de conexión y el costo son predecibles. La lista del proveedor no
sirve como fuente: en noviembre de 2026 Google seguía listando
``gemini-2.5-flash`` y respondía 404 "no longer available to new users". Solo
entra un modelo que respondió de verdad con el esquema de sugerencias.
"""

from __future__ import annotations

PROVIDERS: dict[str, dict] = {
    "gemini": {
        "label": "Google Gemini",
        "key_setting": "ai_gemini_api_key",
        # Probados el 2026-11-08 con el esquema de sugerencias: responden JSON
        # válido (flash ~8 s, lite ~2 s). gemini-3.5-flash quedó afuera: Google
        # lo deprecó y redirige sus pedidos a 3.6-flash.
        "models": ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"],
    },
    "openai": {
        "label": "OpenAI",
        "key_setting": "ai_openai_api_key",
        "models": ["gpt-5.6-terra", "gpt-5.5", "gpt-5-mini", "gpt-4.1-mini"],
    },
}

# Parámetros que cambian según el modelo. ``reasoning_effort`` solo lo aceptan
# los modelos con razonamiento: gpt-4.1-mini responde 400 "Unrecognized request
# argument". Sin fijarlo, gpt-5-mini gastó en razonar todo el presupuesto de
# salida de la prueba y devolvió vacío (finish_reason=length).
MODEL_OPTIONS: dict[str, dict] = {
    "openai:gpt-5.6-terra": {"reasoning_effort": "low"},
    "openai:gpt-5.5": {"reasoning_effort": "low"},
    "openai:gpt-5-mini": {"reasoning_effort": "low"},
}

# Modelos que el proveedor retiró → su reemplazo. Un negocio que los tenía
# guardados sigue funcionando con el reemplazo sin tener que entrar a
# Integraciones; guardar uno retirado ya no se puede.
RETIRED_MODELS: dict[str, str] = {
    "gemini:gemini-2.0-flash": "gemini:gemini-3.6-flash",
    "gemini:gemini-2.5-flash": "gemini:gemini-3.6-flash",
    "gemini:gemini-2.5-flash-lite": "gemini:gemini-3.5-flash-lite",
    "gemini:gemini-2.5-pro": "gemini:gemini-3.6-flash",
    "gemini:gemini-3.5-flash": "gemini:gemini-3.6-flash",
}

# Gemini responde y OpenAI respalda, como en el agente de n8n.
DEFAULT_PRIMARY = "gemini:gemini-3.6-flash"
DEFAULT_FALLBACK = "openai:gpt-5.6-terra"


def parse_model_spec(spec: str) -> tuple[str, str]:
    """``proveedor:modelo`` validado contra el catálogo vigente."""
    provider, _, model = (spec or "").strip().partition(":")
    if provider not in PROVIDERS:
        raise ValueError(f"Proveedor de IA desconocido: {provider or '(vacío)'}")
    if model not in PROVIDERS[provider]["models"]:
        raise ValueError(f"Modelo no disponible para {PROVIDERS[provider]['label']}: {model or '(vacío)'}")
    return provider, model


def resolve_model_spec(spec: str) -> str:
    """Lo guardado por un negocio, llevado al catálogo vigente: un modelo
    retirado se lee como su reemplazo. Para leer configuración; para guardar
    se valida con ``parse_model_spec``."""
    normalized = (spec or "").strip()
    normalized = RETIRED_MODELS.get(normalized, normalized)
    provider, model = parse_model_spec(normalized)
    return f"{provider}:{model}"


def model_options(spec: str) -> dict:
    return dict(MODEL_OPTIONS.get(spec, {}))


def key_setting_for(provider: str) -> str:
    return PROVIDERS[provider]["key_setting"]
