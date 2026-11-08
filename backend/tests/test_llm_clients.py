"""Los clientes de Gemini y OpenAI contra un transporte HTTP simulado: cuerpo
que mandan, lo que devuelven y cómo traducen los errores."""

from __future__ import annotations

import json

import httpx
import pytest

from app.integrations.llm import gemini, openai
from app.integrations.llm.base import LlmError, LlmRequest
from app.integrations.llm.catalog import parse_model_spec
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


def _mock(module, handler, monkeypatch):
    real = module.httpx.AsyncClient
    monkeypatch.setattr(module.httpx, "AsyncClient", lambda **kwargs: real(transport=httpx.MockTransport(handler)))


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
    result = await GeminiClient("clave", "gemini-2.5-flash").complete_json(REQUEST)

    assert sent["url"].endswith("/models/gemini-2.5-flash:generateContent")
    assert sent["key"] == "clave"
    assert sent["body"]["system_instruction"]["parts"][0]["text"] == "sistema"
    assert sent["body"]["generationConfig"]["responseMimeType"] == "application/json"
    assert sent["body"]["generationConfig"]["responseSchema"]["type"] == "OBJECT"
    assert json.loads(result.text) == {"alerta": None, "sugerencias": []}
    assert (result.tokens_in, result.tokens_out, result.model) == (120, 30, "gemini-2.5-flash")


async def test_gemini_rejected_key_is_not_retryable_but_overload_is(monkeypatch):
    status = {"code": 403}

    def handler(_request):
        return httpx.Response(status["code"], json={"error": {"message": "API key not valid"}})

    _mock(gemini, handler, monkeypatch)
    with pytest.raises(LlmError) as error:
        await GeminiClient("mala", "gemini-2.5-flash").ping()
    assert error.value.retryable is False and "API key not valid" in str(error.value)

    status["code"] = 503
    with pytest.raises(LlmError) as error:
        await GeminiClient("clave", "gemini-2.5-flash").ping()
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
    assert parse_model_spec("gemini:gemini-2.5-flash") == ("gemini", "gemini-2.5-flash")
    with pytest.raises(ValueError):
        parse_model_spec("anthropic:claude")
    with pytest.raises(ValueError):
        parse_model_spec("openai:gpt-3")
    assert isinstance(build_client("openai:gpt-5.5", "sk"), OpenAiClient)
    assert isinstance(build_client("gemini:gemini-2.5-pro", "k"), GeminiClient)
