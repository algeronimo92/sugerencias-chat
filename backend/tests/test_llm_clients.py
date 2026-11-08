"""Los clientes de Gemini y OpenAI contra un transporte HTTP simulado: cuerpo
que mandan, lo que devuelven y cómo traducen los errores."""

from __future__ import annotations

import json

import httpx
import pytest

from app.integrations.llm import gemini, openai
from app.integrations.llm.base import LlmError, LlmRequest
from app.integrations.llm.catalog import parse_model_spec, resolve_model_spec
from app.integrations.llm.client import build_client
from app.integrations.llm.gemini import GeminiClient, to_gemini_schema
from app.integrations.llm.openai import OpenAiClient

SCHEMA = {
    "type": "object",
    "properties": {
        "alerta": {"type": ["string", "null"]},
        "sugerencias": {"type": "array", "maxItems": 3, "items": {"type": "object", "properties": {"canal": {"type": "string", "enum": ["texto", "audio"]}}, "required": ["canal"], "additionalProperties": False}},
    },
    "required": ["alerta", "sugerencias"],
    "additionalProperties": False,
}
REQUEST = LlmRequest(system="sistema", user="usuario", schema=SCHEMA, schema_name="prueba")


# El original, tomado una vez: openai y gemini comparten el módulo httpx, y un
# segundo mock en el mismo test envolvía al primero en vez de reemplazarlo.
_REAL_ASYNC_CLIENT = httpx.AsyncClient


def _mock(module, handler, monkeypatch):
    monkeypatch.setattr(module.httpx, "AsyncClient", lambda **kwargs: _REAL_ASYNC_CLIENT(transport=httpx.MockTransport(handler)))


def test_gemini_schema_translation_drops_what_gemini_rejects():
    translated = to_gemini_schema(SCHEMA)
    assert translated["type"] == "OBJECT"
    assert translated["properties"]["alerta"] == {"type": "STRING", "nullable": True}
    items = translated["properties"]["sugerencias"]["items"]
    assert "additionalProperties" not in items
    assert items["properties"]["canal"]["enum"] == ["texto", "audio"]
    assert translated["propertyOrdering"] == ["alerta", "sugerencias"]


async def test_gemini_sends_schema_and_returns_text_and_usage(monkeypatch):
    sent = {}

    def handler(request):
        sent["url"] = str(request.url)
        sent["key"] = request.headers.get("x-goog-api-key")
        sent["body"] = json.loads(request.content)
        return httpx.Response(200, json={
            "candidates": [{"content": {"parts": [{"text": '{"alerta": null, "sugerencias": []}'}]}, "finishReason": "STOP"}],
            "usageMetadata": {"promptTokenCount": 120, "candidatesTokenCount": 30},
        })

    _mock(gemini, handler, monkeypatch)
    result = await GeminiClient("clave", "gemini-3.5-flash").complete_json(REQUEST)

    assert sent["url"].endswith("/models/gemini-3.5-flash:generateContent")
    assert sent["key"] == "clave"
    assert sent["body"]["system_instruction"]["parts"][0]["text"] == "sistema"
    assert sent["body"]["generationConfig"]["responseMimeType"] == "application/json"
    assert sent["body"]["generationConfig"]["responseSchema"]["type"] == "OBJECT"
    # Sin esto Gemini devolvía vacío ante temas clínicos legítimos (lactancia…).
    assert {item["threshold"] for item in sent["body"]["safetySettings"]} == {"BLOCK_NONE"}
    assert len(sent["body"]["safetySettings"]) == 4
    assert json.loads(result.text) == {"alerta": None, "sugerencias": []}
    assert (result.tokens_in, result.tokens_out, result.model) == (120, 30, "gemini-3.5-flash")


async def test_gemini_rejected_key_is_not_retryable_but_overload_is(monkeypatch):
    status = {"code": 403}

    def handler(_request):
        return httpx.Response(status["code"], json={"error": {"message": "API key not valid"}})

    _mock(gemini, handler, monkeypatch)
    with pytest.raises(LlmError) as error:
        await GeminiClient("mala", "gemini-3.5-flash").ping()
    assert error.value.retryable is False and "API key not valid" in str(error.value)

    status["code"] = 503
    with pytest.raises(LlmError) as error:
        await GeminiClient("clave", "gemini-3.5-flash").ping()
    assert error.value.retryable is True


async def test_openai_uses_strict_json_schema_and_reads_usage(monkeypatch):
    sent = {}

    def handler(request):
        sent["auth"] = request.headers.get("authorization")
        sent["body"] = json.loads(request.content)
        return httpx.Response(200, json={
            "model": "gpt-5.5-2026-01-01",
            "choices": [{"message": {"content": '{"alerta": "x", "sugerencias": []}'}, "finish_reason": "stop"}],
            "usage": {"prompt_tokens": 200, "completion_tokens": 40},
        })

    _mock(openai, handler, monkeypatch)
    result = await OpenAiClient("sk-test", "gpt-5.5").complete_json(REQUEST)

    assert sent["auth"] == "Bearer sk-test"
    assert sent["body"]["model"] == "gpt-5.5"
    assert sent["body"]["response_format"]["json_schema"] == {"name": "prueba", "strict": True, "schema": SCHEMA}
    assert "temperature" not in sent["body"]
    assert result.model == "gpt-5.5-2026-01-01" and (result.tokens_in, result.tokens_out) == (200, 40)


async def test_openai_network_failure_is_retryable(monkeypatch):
    def handler(_request):
        raise httpx.ConnectError("boom")

    _mock(openai, handler, monkeypatch)
    with pytest.raises(LlmError) as error:
        await OpenAiClient("sk", "gpt-5.5").ping()
    assert error.value.retryable is True


def test_model_specs_are_a_closed_catalog():
    assert parse_model_spec("gemini:gemini-3.5-flash") == ("gemini", "gemini-3.5-flash")
    with pytest.raises(ValueError):
        parse_model_spec("anthropic:claude")
    with pytest.raises(ValueError):
        parse_model_spec("openai:gpt-3")
    # Retirado: no se puede guardar, pero lo ya guardado se lee como su reemplazo.
    with pytest.raises(ValueError):
        parse_model_spec("gemini:gemini-2.5-flash")
    assert resolve_model_spec("gemini:gemini-2.5-flash") == "gemini:gemini-3.5-flash"
    assert resolve_model_spec(" gemini:gemini-2.0-flash ") == "gemini:gemini-3.5-flash"
    assert isinstance(build_client("openai:gpt-5.5", "sk"), OpenAiClient)
    retired = build_client("gemini:gemini-2.5-pro", "k")
    assert isinstance(retired, GeminiClient) and retired.model == "gemini-3.6-flash"


async def test_openai_sends_reasoning_effort_only_to_models_that_accept_it(monkeypatch):
    bodies = []

    def handler(request):
        bodies.append(json.loads(request.content))
        return httpx.Response(200, json={"choices": [{"message": {"content": "{}"}, "finish_reason": "stop"}]})

    _mock(openai, handler, monkeypatch)
    await build_client("openai:gpt-5.6-terra", "sk").complete_json(REQUEST)
    await build_client("openai:gpt-4.1-mini", "sk").complete_json(REQUEST)

    assert bodies[0]["reasoning_effort"] == "low"
    # gpt-4.1-mini responde 400 "Unrecognized request argument" si se lo manda.
    assert "reasoning_effort" not in bodies[1]


async def test_a_response_cut_by_length_or_blocked_fails_clearly(monkeypatch):
    _mock(openai, lambda _r: httpx.Response(200, json={
        "choices": [{"message": {"content": ""}, "finish_reason": "length"}],
    }), monkeypatch)
    with pytest.raises(LlmError, match="longitud") as error:
        await OpenAiClient("sk", "gpt-5-mini").complete_json(REQUEST)
    assert error.value.retryable is True

    reason = {"value": "MAX_TOKENS"}
    _mock(gemini, lambda _r: httpx.Response(200, json={
        "candidates": [{"content": {"parts": [{"text": '{"alerta": nu'}]}, "finishReason": reason["value"]}],
    }), monkeypatch)
    with pytest.raises(LlmError, match="longitud"):
        await GeminiClient("k", "gemini-3.5-flash").complete_json(REQUEST)
    reason["value"] = "SAFETY"
    with pytest.raises(LlmError, match="SAFETY"):
        await GeminiClient("k", "gemini-3.5-flash").complete_json(REQUEST)


async def test_list_models_validates_the_key_without_generating(monkeypatch):
    seen = []

    def gemini_handler(request):
        seen.append((request.method, request.url.path))
        return httpx.Response(200, json={"models": [
            {"name": "models/gemini-3.5-flash", "supportedGenerationMethods": ["generateContent"]},
            {"name": "models/gemini-embedding-001", "supportedGenerationMethods": ["embedContent"]},
        ]})

    _mock(gemini, gemini_handler, monkeypatch)
    assert await GeminiClient("k", "gemini-3.5-flash").list_models() == {"gemini-3.5-flash"}
    assert seen == [("GET", "/v1beta/models")]

    _mock(openai, lambda _r: httpx.Response(200, json={"data": [{"id": "gpt-5.5"}, {"id": "gpt-4.1-mini"}]}), monkeypatch)
    assert await OpenAiClient("sk", "gpt-5.5").list_models() == {"gpt-5.5", "gpt-4.1-mini"}

    _mock(openai, lambda _r: httpx.Response(401, json={"error": {"message": "Incorrect API key"}}), monkeypatch)
    with pytest.raises(LlmError) as error:
        await OpenAiClient("mala", "gpt-5.5").list_models()
    assert error.value.retryable is False and "Incorrect API key" in str(error.value)
