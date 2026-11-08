"""Estado y prueba de los proveedores de IA del negocio (tarjeta "Asistente IA")."""

from __future__ import annotations

from time import monotonic

from app.integrations.llm.base import LlmError
from app.integrations.llm.catalog import DEFAULT_FALLBACK, DEFAULT_PRIMARY, PROVIDERS, SPECS, key_setting_for, params_schema, parse_model_spec, parse_overrides, resolve_model_spec, sanitize_overrides
from app.integrations.llm.client import build_client
from app.modules.ai.ai_access import business_ai_ready
from app.modules.platform.ports.settings_service import get_effective_many

_KEYS = (
    "ai_suggestions_primary_model", "ai_suggestions_fallback_model",
    "ai_suggestions_primary_params", "ai_suggestions_fallback_params",
    "ai_gemini_api_key", "ai_openai_api_key",
)


async def providers_status() -> dict:
    values = await get_effective_many(_KEYS)
    primary = _resolved(values["ai_suggestions_primary_model"], DEFAULT_PRIMARY)
    fallback = _resolved(values["ai_suggestions_fallback_model"], DEFAULT_FALLBACK)
    return {
        "providers": [
            {
                "provider": name,
                "label": meta["label"],
                "models": list(meta["models"]),
                "key_configured": bool(values[meta["key_setting"]].strip()),
            }
            for name, meta in PROVIDERS.items()
        ],
        # Lo que de verdad se usa: un modelo retirado se muestra con su reemplazo.
        "primary_model": primary,
        "fallback_model": fallback,
        "ready": await business_ai_ready(),
        "model_params": {spec: params_schema(spec) for spec in SPECS},
        # Solo lo que aplica al modelo actual de cada posición.
        "primary_params": sanitize_overrides(primary, parse_overrides(values["ai_suggestions_primary_params"]))[0],
        "fallback_params": sanitize_overrides(fallback, parse_overrides(values["ai_suggestions_fallback_params"]))[0],
    }


def _resolved(stored: str, default: str) -> str:
    try:
        return resolve_model_spec(stored.strip() or default)
    except ValueError:
        return default


async def test_provider(provider: str, *, api_key: str | None, model: str | None, client_factory=build_client) -> dict:
    """Sin ``model``, prueba solo la clave: pide la lista de modelos, que no
    genera nada ni depende de que un modelo puntual exista. Antes se probaba
    contra el modelo elegido, y una clave buena se rechazaba cuando Google
    había retirado ese modelo. Con ``model``, hace una generación mínima."""
    if provider not in PROVIDERS:
        return {"ok": False, "provider": provider, "error": "Proveedor desconocido"}
    key = (api_key or "").strip()
    if not key:
        key = (await get_effective_many((key_setting_for(provider),)))[key_setting_for(provider)].strip()
    if not key:
        return {"ok": False, "provider": provider, "error": "Falta la API key"}
    chosen = (model or "").strip()
    try:
        parse_model_spec(f"{provider}:{chosen or PROVIDERS[provider]['models'][0]}")
    except ValueError as exc:
        return {"ok": False, "provider": provider, "model": chosen, "error": str(exc)}
    client = client_factory(f"{provider}:{chosen or PROVIDERS[provider]['models'][0]}", key)
    started = monotonic()
    try:
        if not chosen:
            available = await client.list_models()
            return {
                "ok": True, "provider": provider, "model": None,
                "latency_ms": int((monotonic() - started) * 1000),
                "models_available": len(available),
            }
        result = await client.ping()
    except LlmError as exc:
        return {"ok": False, "provider": provider, "model": chosen or None, "error": str(exc)}
    return {
        "ok": True, "provider": provider, "model": result.model or chosen,
        "latency_ms": int((monotonic() - started) * 1000),
    }
