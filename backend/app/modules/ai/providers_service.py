"""Estado y prueba de los proveedores de IA del negocio (tarjeta "Asistente IA")."""

from __future__ import annotations

from time import monotonic

from app.integrations.llm.base import LlmError
from app.integrations.llm.catalog import DEFAULT_FALLBACK, DEFAULT_PRIMARY, PROVIDERS, key_setting_for, parse_model_spec
from app.integrations.llm.client import build_client
from app.modules.ai.ai_access import business_ai_ready
from app.modules.ai.infrastructure.routing_provider import suggestions_mode
from app.modules.platform.ports.settings_service import get_effective_many

_KEYS = ("ai_suggestions_primary_model", "ai_suggestions_fallback_model", "ai_gemini_api_key", "ai_openai_api_key")


async def providers_status() -> dict:
    values = await get_effective_many(_KEYS)
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
        "primary_model": values["ai_suggestions_primary_model"].strip() or DEFAULT_PRIMARY,
        "fallback_model": values["ai_suggestions_fallback_model"].strip() or DEFAULT_FALLBACK,
        "suggestions_mode": await suggestions_mode(),
        "ready": await business_ai_ready(),
    }


async def test_provider(provider: str, *, api_key: str | None, model: str | None, client_factory=build_client) -> dict:
    if provider not in PROVIDERS:
        return {"ok": False, "provider": provider, "error": "Proveedor desconocido"}
    key = (api_key or "").strip()
    if not key:
        key = (await get_effective_many((key_setting_for(provider),)))[key_setting_for(provider)].strip()
    if not key:
        return {"ok": False, "provider": provider, "error": "Falta la API key"}
    chosen = (model or "").strip() or PROVIDERS[provider]["models"][0]
    try:
        parse_model_spec(f"{provider}:{chosen}")
    except ValueError as exc:
        return {"ok": False, "provider": provider, "model": chosen, "error": str(exc)}
    client = client_factory(f"{provider}:{chosen}", key)
    started = monotonic()
    try:
        result = await client.ping()
    except LlmError as exc:
        return {"ok": False, "provider": provider, "model": chosen, "error": str(exc)}
    return {
        "ok": True, "provider": provider, "model": result.model or chosen,
        "latency_ms": int((monotonic() - started) * 1000),
    }
