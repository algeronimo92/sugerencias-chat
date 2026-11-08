"""El copiloto nativo con un modelo simulado: qué entra al prompt, cómo
reintenta y cae al secundario, qué pasos y metadatos deja en el job."""

from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest

from app.integrations.llm.base import LlmError, LlmRequest, LlmResult
from app.modules.ai import ai_access, providers_service
from app.modules.ai.infrastructure import native_provider
from app.modules.ai.infrastructure.native_provider import NativeAiProvider, NativeSuggestionError, build_user_prompt, knowledge_queries
from app.modules.ai.infrastructure.routing_provider import RoutingAiProvider

GOOD = json.dumps({
    "analisis": "Quiere tratar manchas antes de su boda",
    "confianza": "alta",
    "senal_compra": True,
    "alerta": None,
    "sugerencias": [{
        "tactica": "Cerrar con el pack",
        "canal": "texto",
        "texto": "Hola Ana, el pack x3 de Hollywood Peel - Rostro cuesta 400.",
        "adjuntos": [],
        "motivo_adjuntos": "",
        "porque": "Ya preguntó por precio dos veces",
    }],
})

CONTEXT = {
    "context_revision": "rev-1",
    "lead": {
        "nombre": "Ana", "estado": "calificado", "servicio_interes": "Hollywood Peel - Rostro", "ultimo_emisor": "cliente",
        "ultimo_mensaje_at": "2026-11-07T15:00:00+00:00",
        "compras": [{"servicio": "Borrado de Cejas", "paquete": "Individual", "sesiones": 1, "monto": "300.00", "fecha": "2026-10-01"}],
    },
    "messages": [
        {"id": 3, "sender": "cliente", "content": "¿Cuánto cuesta el pack de 3?", "sent_at": "2026-11-07T15:00:00+00:00", "message_type": "text"},
        {"id": 2, "sender": "vendedor", "content": "Hola Ana", "sent_at": "2026-11-07T14:00:00+00:00", "message_type": "text"},
        {"id": 1, "sender": "cliente", "content": "Hola, quiero quitar manchas", "sent_at": "2026-11-07T13:00:00+00:00", "message_type": "text"},
    ],
    "system_events": [],
    "message_cursor": None,
}
CATALOG = [{
    "id": 1, "name": "Hollywood Peel - Rostro", "price": "180.00",
    "packages": [{"name": "Individual", "sessions": 1, "price": "180.00", "notes": None}, {"name": "x3", "sessions": 3, "price": "400.00", "notes": None}],
}]


class FakeClient:
    def __init__(self, provider, model, replies):
        self.provider, self.model, self._replies = provider, model, list(replies)
        self.requests: list[LlmRequest] = []

    async def complete_json(self, request):
        self.requests.append(request)
        reply = self._replies.pop(0)
        if isinstance(reply, Exception):
            raise reply
        return LlmResult(text=reply, model=self.model, tokens_in=100, tokens_out=20)

    async def ping(self):
        return LlmResult(text="OK", model=self.model)

    async def list_models(self):
        return {"modelo-a", "modelo-b"}


def _world(monkeypatch, settings: dict, chain: dict[str, list]):
    """Un negocio con sus claves y un cliente simulado por modelo."""
    clients: dict[str, FakeClient] = {}
    built_with: dict[str, dict | None] = {}

    def factory(spec, api_key, overrides=None):
        provider, model = spec.split(":", 1)
        assert api_key, "nunca se construye un cliente sin clave"
        built_with[spec] = overrides
        clients[spec] = FakeClient(provider, model, chain[spec])
        return clients[spec]

    factory.built_with = built_with

    defaults = {"ai_suggestions_primary_model": "", "ai_suggestions_fallback_model": "", "ai_gemini_api_key": "", "ai_openai_api_key": ""}
    values = {**defaults, **settings}

    async def effective_many(keys):
        return {key: values.get(key, "") for key in keys}

    monkeypatch.setattr(native_provider, "get_effective_many", effective_many)
    monkeypatch.setattr(native_provider, "start_ai_job", AsyncMock())
    monkeypatch.setattr(native_provider, "fetch_analysis_context", AsyncMock(return_value=CONTEXT))
    monkeypatch.setattr(native_provider, "fetch_tenant_config", AsyncMock(return_value={"negocio": {"nombre": "DermicaPro"}, "moneda": "PEN"}))
    monkeypatch.setattr(native_provider, "list_ai_catalog", AsyncMock(return_value=CATALOG))
    monkeypatch.setattr(native_provider, "list_ai_resources", AsyncMock(return_value=[{"id": 9, "nombre": "flyer.pdf", "url": "https://m/flyer.pdf", "descripcion": "Promo"}]))
    searched: list[str] = []

    async def search(query, top_k, service_id=None):
        searched.append((query, service_id) if service_id else query)
        if service_id:
            return []
        return [{"id": "c1", "title": "Ficha Hollywood Peel", "source": None, "content": "Peeling con carbón activado, 3 sesiones recomendadas.", "metadata": {}, "score": 1.0}]

    async def by_service(service_id, top_k):
        searched.append(("servicio", service_id))
        return [{"id": "s1", "title": "Ficha del servicio", "document_type": "ficha", "source": None, "content": "Contraindicado en embarazo.", "metadata": {}, "score": 0.0}]

    monkeypatch.setattr(native_provider, "search_knowledge_chunks", search)
    monkeypatch.setattr(native_provider, "service_knowledge_chunks", by_service)
    steps: list[str] = []
    monkeypatch.setattr(native_provider, "record_ai_job_step", AsyncMock(side_effect=lambda job_id, step: steps.append(step) or True))
    metadata: dict = {}

    async def record_metadata(job_id, **values):
        metadata.update(values)
        return True

    monkeypatch.setattr(native_provider, "record_ai_job_metadata", record_metadata)
    return NativeAiProvider(client_factory=factory), clients, searched, steps, metadata


async def _suggest(provider):
    return await provider.suggest("lead-1", "51999", refresh=False, instruction="no dar descuento", job_id="job-1", context_revision="rev-1", tenant_context_token="tok")


async def test_prompt_carries_catalog_packages_purchases_knowledge_and_history(monkeypatch):
    provider, clients, searched, steps, metadata = _world(
        monkeypatch, {"ai_gemini_api_key": "g-key"}, {"gemini:gemini-3.6-flash": [GOOD]},
    )

    suggestion = await _suggest(provider)

    assert suggestion.sugerencias[0].texto.startswith("Hola Ana")
    [client] = clients.values()
    prompt = client.requests[0].user
    assert '"paquetes"' in prompt and '"x3"' in prompt and '"400.00"' in prompt
    assert '"Borrado de Cejas"' in prompt  # compras previas
    assert "Peeling con carbón activado" in prompt  # conocimiento
    assert "Hola, quiero quitar manchas" in prompt  # historial, más antiguo arriba
    assert prompt.index("Hola, quiero quitar manchas") < prompt.index("¿Cuánto cuesta el pack de 3?")
    assert "no dar descuento" in prompt
    assert "DermicaPro" in prompt
    assert client.requests[0].system.startswith("# IDENTIDAD Y MISION")
    # Primero los documentos del servicio de interés (sin coincidencias con la
    # conversación, sus fichas en orden), después la búsqueda general.
    assert searched == [
        ("quitar or manchas or cuesta or pack", 1), ("servicio", 1),
        "Hollywood Peel - Rostro", "quitar or manchas or cuesta or pack", "descuento",
    ]
    assert "Contraindicado en embarazo" in prompt and '"tipo": "ficha"' in prompt
    assert steps == ["context_loaded", "knowledge_searched"]
    assert metadata["model"] == "gemini:gemini-3.6-flash"
    assert metadata["knowledge_chunk_ids"] == ["s1", "c1"]
    assert (metadata["tokens_in"], metadata["tokens_out"]) == (100, 20)
    assert metadata["prompt_version"] == native_provider.PROMPT_VERSION


async def test_invalid_json_gets_one_retry_then_the_fallback_model(monkeypatch):
    provider, clients, *_ , metadata = _world(
        monkeypatch,
        {"ai_gemini_api_key": "g-key", "ai_openai_api_key": "o-key"},
        {"gemini:gemini-3.6-flash": ["no es json", '{"analisis": "sin sugerencias"}'], "openai:gpt-5.6-terra": [GOOD]},
    )

    suggestion = await _suggest(provider)

    assert suggestion.confianza == "alta"
    gemini = clients["gemini:gemini-3.6-flash"]
    assert len(gemini.requests) == 2
    assert "no cumplió el esquema" in gemini.requests[1].user
    assert metadata["model"] == "openai:gpt-5.6-terra"
    assert metadata["failed_models"] and metadata["failed_models"][0].startswith("gemini:gemini-3.6-flash")


async def test_primary_outage_falls_back_and_total_failure_is_reported(monkeypatch):
    provider, clients, *_ = _world(
        monkeypatch,
        {"ai_suggestions_primary_model": "openai:gpt-5.5", "ai_suggestions_fallback_model": "gemini:gemini-2.0-flash", "ai_gemini_api_key": "g", "ai_openai_api_key": "o"},
        {"openai:gpt-5.5": [LlmError("OpenAI respondió 503", status=503)], "gemini:gemini-3.6-flash": [GOOD]},
    )
    assert (await _suggest(provider)).confianza == "alta"
    assert list(clients) == ["openai:gpt-5.5", "gemini:gemini-3.6-flash"]

    provider, *_ = _world(
        monkeypatch, {"ai_gemini_api_key": "g"}, {"gemini:gemini-3.6-flash": [LlmError("Gemini respondió 403", status=403, retryable=False)]},
    )
    with pytest.raises(NativeSuggestionError) as error:
        await _suggest(provider)
    assert "403" in str(error.value)


async def test_without_keys_nothing_is_called(monkeypatch):
    provider, clients, searched, steps, _ = _world(monkeypatch, {}, {})
    with pytest.raises(NativeSuggestionError):
        await _suggest(provider)
    assert clients == {} and searched == [] and steps == []


async def test_only_models_with_a_key_enter_the_chain(monkeypatch):
    provider, clients, *_ = _world(monkeypatch, {"ai_openai_api_key": "o"}, {"openai:gpt-5.6-terra": [GOOD]})
    await _suggest(provider)
    assert list(clients) == ["openai:gpt-5.6-terra"]


def test_knowledge_queries_and_prompt_without_messages():
    assert knowledge_queries({"servicio_interes": "Botox"}, [], None) == ["Botox"]
    assert native_provider.or_query("¿Cuántas sesiones necesito para las manchas? 3") == "sesiones or manchas"
    assert knowledge_queries({}, [], "  ") == []
    from datetime import datetime, timezone
    prompt = build_user_prompt(
        tenant_config={}, lead={}, messages=[], resources=[], catalog=[], knowledge=[], instruction=None,
        now=datetime(2026, 11, 7, tzinfo=timezone.utc),
    )
    assert "<catalogo>" in prompt and "<historial>" in prompt


async def test_suggestions_are_always_native_and_analysis_stays_in_n8n():
    n8n = type("N8n", (), {"analyze": AsyncMock(return_value="analista")})()
    native = type("Native", (), {"suggest": AsyncMock(return_value="nativo"), "analyze": AsyncMock()})()
    provider = RoutingAiProvider(n8n, native)
    kwargs = dict(refresh=False, instruction=None, job_id="j", context_revision="r", tenant_context_token="t")

    assert await provider.suggest("c", None, **kwargs) == "nativo"
    assert await provider.analyze("c", job_id="j", context_revision="r", tenant_context_token="t") == "analista"
    native.analyze.assert_not_called()


async def test_suggestions_require_a_business_key(monkeypatch):
    monkeypatch.setattr(ai_access, "signing_key_configured", lambda: True)
    monkeypatch.setattr(ai_access, "platform_setting", AsyncMock(return_value=""))

    async def no_keys(_keys):
        return {"ai_suggestions_primary_model": "", "ai_suggestions_fallback_model": "", "ai_gemini_api_key": "", "ai_openai_api_key": ""}

    monkeypatch.setattr(ai_access, "get_effective_many", no_keys)
    with pytest.raises(ai_access.AIUnavailableError) as error:
        await ai_access.platform_ready("rag")
    assert error.value.code == "ai_key_missing" and "Integraciones" in error.value.message

    async def with_key(_keys):
        return {"ai_suggestions_primary_model": "", "ai_suggestions_fallback_model": "", "ai_gemini_api_key": "g", "ai_openai_api_key": ""}

    monkeypatch.setattr(ai_access, "get_effective_many", with_key)
    assert await ai_access.platform_ready("rag") is True
    # El analista sigue exigiendo el workflow de n8n.
    assert await ai_access.platform_ready("analyst") is False


async def test_connection_test_uses_typed_key_or_saved_one(monkeypatch):
    built = []

    def factory(spec, api_key):
        built.append((spec, api_key))
        return FakeClient(*spec.split(":", 1), replies=[])

    async def saved(keys):
        return {key: ("guardada" if key == "ai_openai_api_key" else "") for key in keys}

    monkeypatch.setattr(providers_service, "get_effective_many", saved)

    # Sin modelo se prueba solo la clave, con la lista de modelos: una clave
    # buena no se rechaza porque el modelo elegido haya sido retirado.
    result = await providers_service.test_provider("gemini", api_key=" nueva ", model=None, client_factory=factory)
    assert result["ok"] is True and result["model"] is None and result["models_available"] == 2
    assert built[-1][1] == "nueva"

    result = await providers_service.test_provider("openai", api_key=None, model="gpt-5.5", client_factory=factory)
    assert result["ok"] is True and built[-1] == ("openai:gpt-5.5", "guardada")

    result = await providers_service.test_provider("gemini", api_key=None, model=None, client_factory=factory)
    assert result["ok"] is False and "API key" in result["error"]

    result = await providers_service.test_provider("openai", api_key="k", model="gpt-3", client_factory=factory)
    assert result["ok"] is False and "no disponible" in result["error"]

    def failing(spec, api_key):
        return FakeClient(*spec.split(":", 1), replies=[])

    class Broken(FakeClient):
        async def list_models(self):
            raise LlmError("OpenAI respondió 401: bad key", status=401, retryable=False)

    result = await providers_service.test_provider("openai", api_key="k", model=None, client_factory=lambda s, k: Broken(*s.split(":", 1), replies=[]))
    assert result["ok"] is False and "401" in result["error"]


async def test_each_slot_uses_the_parameters_the_business_set_for_it(monkeypatch):
    provider, clients, *_, metadata = _world(
        monkeypatch,
        {
            "ai_gemini_api_key": "g", "ai_openai_api_key": "o",
            "ai_suggestions_primary_params": '{"reasoning": "high"}',
            "ai_suggestions_fallback_params": '{"reasoning": "none", "temperature": 0.4}',
        },
        {"gemini:gemini-3.6-flash": [LlmError("Gemini respondió 503", status=503)], "openai:gpt-5.6-terra": [GOOD]},
    )

    await _suggest(provider)

    built = provider._build.built_with
    assert built["gemini:gemini-3.6-flash"] == {"reasoning": "high"}
    assert built["openai:gpt-5.6-terra"] == {"reasoning": "none", "temperature": 0.4}
    # El job guarda con qué parámetros efectivos se generó (defaults incluidos).
    assert metadata["params"]["temperature"] == 0.4 and metadata["params"]["max_output_tokens"] == 8000
