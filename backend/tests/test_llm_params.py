"""Registro de parámetros por modelo: lo que el negocio puede sobrescribir, cómo
se valida y cómo lo traduce cada adaptador al dialecto de su API.

Las reglas salen de pruebas contra las APIs reales (2026-11-08): gpt-5.x
rechaza temperature salvo con reasoning="none", gpt-4.1-mini rechaza
reasoning_effort, gpt-5-mini no acepta "none" ni "xhigh", Gemini 3.5 Flash-Lite
no acepta "none"…"""

from __future__ import annotations

import json

import httpx
import pytest

from app.integrations.llm import gemini, openai
from app.integrations.llm.base import LlmRequest
from app.integrations.llm.catalog import (
    DEFAULT_FALLBACK, DEFAULT_PRIMARY, RETIRED_MODELS, SPECS, _check, effective_params,
    parse_overrides, sanitize_overrides, validate_overrides,
)
from app.integrations.llm.client import build_client
from app.modules.platform import settings_service

REQUEST = LlmRequest(system="s", user="u", schema={"type": "object", "properties": {}, "required": [], "additionalProperties": False})
_REAL_ASYNC_CLIENT = httpx.AsyncClient


def _capture(module, monkeypatch, reply: dict) -> list[dict]:
    bodies: list[dict] = []

    def handler(request):
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json=reply)

    monkeypatch.setattr(module.httpx, "AsyncClient", lambda **kwargs: _REAL_ASYNC_CLIENT(transport=httpx.MockTransport(handler)))
    return bodies


def test_the_registry_is_self_consistent():
    assert DEFAULT_PRIMARY in SPECS and DEFAULT_FALLBACK in SPECS
    assert all(target in SPECS for target in RETIRED_MODELS.values())
    for name, spec in SPECS.items():
        for param_name, param in spec.params.items():
            assert param.kind in {"choice", "float", "int", "text_list"}, (name, param_name)
            if param.default is not None:
                _check(param_name, param, param.default)
            for other in param.requires:
                assert other in spec.params, (name, param_name, other)
        # Lo que el registro manda por defecto tiene que ser aceptado por el propio registro.
        assert validate_overrides(name, effective_params(name)) == effective_params(name)


@pytest.mark.parametrize(("model", "overrides", "message"), [
    ("openai:gpt-5.6-terra", {"temperature": 0.4}, "razonamiento 'none'"),
    ("openai:gpt-5-mini", {"reasoning": "none"}, "no es válido"),
    ("openai:gpt-5-mini", {"temperature": 0.4}, "no acepta"),
    ("openai:gpt-4.1-mini", {"reasoning": "low"}, "no acepta"),
    ("openai:gpt-4.1-mini", {"temperature": 3}, "entre 0 y 2"),
    ("openai:gpt-4.1-mini", {"stop": ["a", "b", "c", "d", "e"]}, "como máximo 4"),
    ("gemini:gemini-3.5-flash-lite", {"reasoning": "none"}, "no es válido"),
    ("gemini:gemini-3.6-flash", {"max_output_tokens": 10}, "entre 256"),
    ("gemini:gemini-3.6-flash", {"temperature": 1.0}, "no acepta"),
])
def test_what_a_model_does_not_accept_is_rejected_with_a_reason(model, overrides, message):
    with pytest.raises(ValueError, match=message):
        validate_overrides(model, overrides)


def test_what_a_model_accepts_is_kept_and_none_resets_to_the_default():
    assert validate_overrides("openai:gpt-5.6-terra", {"reasoning": "none", "temperature": 0.4}) == {"reasoning": "none", "temperature": 0.4}
    assert validate_overrides("openai:gpt-4.1-mini", {"temperature": 0.2, "seed": 7}) == {"temperature": 0.2, "seed": 7}
    assert validate_overrides("gemini:gemini-3.6-flash", {"reasoning": "high", "max_output_tokens": None}) == {"reasoning": "high"}


def test_changing_model_drops_only_what_the_new_one_rejects():
    kept, dropped = sanitize_overrides("openai:gpt-5-mini", {"reasoning": "minimal", "temperature": 0.3, "seed": 4})
    assert kept == {"reasoning": "minimal", "seed": 4} and dropped == ["temperature"]


def test_effective_params_merge_defaults_and_hide_what_does_not_apply():
    assert effective_params("openai:gpt-5.6-terra") == {"reasoning": "low", "verbosity": "medium", "max_output_tokens": 8000, "timeout_seconds": 60}
    # Con un retiro de modelo, lo guardado se aplica al reemplazo si es válido ahí.
    assert effective_params("gemini:gemini-2.5-flash", {"reasoning": "high"})["reasoning"] == "high"
    assert parse_overrides("no es json") == {} and parse_overrides("") == {}


async def test_openai_translates_neutral_params_to_its_wire_names(monkeypatch):
    reply = {"choices": [{"message": {"content": "{}"}, "finish_reason": "stop"}]}
    bodies = _capture(openai, monkeypatch, reply)

    await build_client("openai:gpt-5.6-terra", "k", {"reasoning": "none", "temperature": 0.4, "max_output_tokens": 3000}).complete_json(REQUEST)
    await build_client("openai:gpt-4.1-mini", "k", {"stop": ["##"], "seed": 3}).complete_json(REQUEST)

    assert bodies[0]["reasoning_effort"] == "none" and bodies[0]["temperature"] == 0.4
    assert bodies[0]["max_completion_tokens"] == 3000 and "max_output_tokens" not in bodies[0]
    assert "timeout_seconds" not in bodies[0]
    assert bodies[1]["stop"] == ["##"] and bodies[1]["seed"] == 3
    assert "reasoning_effort" not in bodies[1] and "verbosity" not in bodies[1]


async def test_gemini_translates_neutral_params_to_generation_config(monkeypatch):
    reply = {"candidates": [{"content": {"parts": [{"text": "{}"}]}, "finishReason": "STOP"}]}
    bodies = _capture(gemini, monkeypatch, reply)

    await build_client("gemini:gemini-3.6-flash", "k", {"reasoning": "high", "stop": ["FIN"], "max_output_tokens": 4000}).complete_json(REQUEST)

    config = bodies[0]["generationConfig"]
    assert config["thinkingConfig"] == {"thinkingLevel": "HIGH"}
    assert config["stopSequences"] == ["FIN"] and config["maxOutputTokens"] == 4000
    assert config["responseMimeType"] == "application/json"
    assert "temperature" not in config


async def test_saving_params_validates_them_against_the_model_of_that_slot(monkeypatch):
    stored = {}
    effective = {"ai_suggestions_fallback_model": "openai:gpt-5.6-terra", "ai_suggestions_fallback_params": '{"reasoning": "none", "temperature": 0.5}'}

    async def get_effective(key):
        return effective.get(key, "")

    async def upsert(values):
        stored.update(values)

    monkeypatch.setattr(settings_service, "get_effective", get_effective)
    monkeypatch.setattr(settings_service.settings_repository, "upsert_values", upsert)

    with pytest.raises(ValueError, match="razonamiento 'none'"):
        await settings_service.update_settings({"ai_suggestions_primary_model": "openai:gpt-5.5", "ai_suggestions_primary_params": '{"temperature": 0.5}'})

    await settings_service.update_settings({"ai_suggestions_primary_model": "openai:gpt-5.5", "ai_suggestions_primary_params": '{"reasoning": "none", "temperature": 0.5}'})
    assert json.loads(stored["ai_suggestions_primary_params"]) == {"reasoning": "none", "temperature": 0.5}

    # Cambiar el secundario a un modelo que no acepta temperature la descarta sola.
    await settings_service.update_settings({"ai_suggestions_fallback_model": "openai:gpt-5-mini"})
    assert stored["ai_suggestions_fallback_params"] is None


def test_without_a_choice_the_provider_with_a_key_processes():
    from app.integrations.llm.catalog import default_models

    assert default_models({"ai_openai_api_key": "sk"}) == ("openai:gpt-5.6-terra", "gemini:gemini-3.6-flash")
    assert default_models({"ai_gemini_api_key": "g"}) == ("gemini:gemini-3.6-flash", "openai:gpt-5.6-terra")
    assert default_models({}) == ("gemini:gemini-3.6-flash", "openai:gpt-5.6-terra")


@pytest.mark.parametrize(("stored", "saving", "expected"), [
    # La primera clave define quién procesa.
    ({}, {"ai_openai_api_key": "sk"}, ("openai:gpt-5.6-terra", "gemini:gemini-3.6-flash")),
    ({}, {"ai_gemini_api_key": "g"}, ("gemini:gemini-3.6-flash", "openai:gpt-5.6-terra")),
    # La segunda llega con la primera ya cargada (sin orden guardado): procesa la primera.
    ({"ai_openai_api_key": "sk"}, {"ai_gemini_api_key": "g"}, ("openai:gpt-5.6-terra", "gemini:gemini-3.6-flash")),
    # Una elección explícita no se toca.
    ({"ai_suggestions_primary_model": "gemini:gemini-3.6-flash"}, {"ai_openai_api_key": "sk"}, None),
])
async def test_the_first_ai_key_decides_who_processes(monkeypatch, stored, saving, expected):
    saved = {}

    async def get_effective(key):
        return stored.get(key, "")

    async def upsert(values):
        saved.update(values)

    monkeypatch.setattr(settings_service, "get_effective", get_effective)
    monkeypatch.setattr(settings_service.settings_repository, "upsert_values", upsert)

    await settings_service.update_settings(saving)

    if expected is None:
        assert "ai_suggestions_primary_model" not in saved
    else:
        assert (saved["ai_suggestions_primary_model"], saved["ai_suggestions_fallback_model"]) == expected
