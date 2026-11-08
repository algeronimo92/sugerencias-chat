"""Búsqueda híbrida del conocimiento: el cliente de embeddings contra un
transporte HTTP simulado, la fusión RRF y cómo el copiloto combina palabras y
significado (y sigue solo por palabras si los embeddings fallan)."""

from __future__ import annotations

import json
import math
from unittest.mock import AsyncMock

import httpx
import pytest

from app.integrations.llm import embeddings
from app.integrations.llm.base import LlmError
from app.integrations.llm.embeddings import DIMENSIONS, EMBEDDING_MODELS, EmbeddingClient, build_embedding_client
from app.modules.ai.infrastructure import native_provider
from app.modules.ai.knowledge_search import fuse_rankings

_REAL_ASYNC_CLIENT = httpx.AsyncClient


def _mock(handler, monkeypatch):
    monkeypatch.setattr(embeddings.httpx, "AsyncClient", lambda **kwargs: _REAL_ASYNC_CLIENT(transport=httpx.MockTransport(handler)))


def _vector(scale: float) -> list[float]:
    return [scale] * DIMENSIONS


async def test_embeddings_request_dimensions_and_come_back_normalized_in_order(monkeypatch):
    sent = {}

    def handler(request: httpx.Request) -> httpx.Response:
        sent["url"] = str(request.url)
        sent["auth"] = request.headers["authorization"]
        sent["body"] = json.loads(request.content)
        # Desordenados a propósito: el orden lo da ``index``.
        return httpx.Response(200, json={"data": [
            {"index": 1, "embedding": _vector(2.0)},
            {"index": 0, "embedding": [3.0, 4.0] + [0.0] * (DIMENSIONS - 2)},
        ]})

    _mock(handler, monkeypatch)
    client = build_embedding_client("openai", "sk-negocio")

    first, second = await client.embed(["flacidez", "manchas"])

    assert sent["url"] == "https://api.openai.com/v1/embeddings"
    assert sent["auth"] == "Bearer sk-negocio"
    assert sent["body"] == {"model": "text-embedding-3-small", "input": ["flacidez", "manchas"], "dimensions": DIMENSIONS}
    assert first[:2] == pytest.approx([0.6, 0.8])
    assert math.sqrt(sum(value * value for value in second)) == pytest.approx(1.0)
    assert client.spec == f"openai:text-embedding-3-small@{DIMENSIONS}"


async def test_gemini_goes_through_its_openai_compatible_endpoint_and_may_wrap_the_reply(monkeypatch):
    def handler(request: httpx.Request) -> httpx.Response:
        assert str(request.url) == "https://generativelanguage.googleapis.com/v1beta/openai/embeddings"
        return httpx.Response(200, json=[{"data": [{"index": 0, "embedding": _vector(1.0)}]}])

    _mock(handler, monkeypatch)

    [vector] = await build_embedding_client("gemini", "g-key").embed(["hola"])

    assert len(vector) == DIMENSIONS


async def test_batches_and_errors(monkeypatch):
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        texts = json.loads(request.content)["input"]
        calls.append(len(texts))
        return httpx.Response(200, json={"data": [{"index": i, "embedding": _vector(1.0)} for i in range(len(texts))]})

    _mock(handler, monkeypatch)
    vectors = await EmbeddingClient(EMBEDDING_MODELS["openai"], "k").embed([f"t{i}" for i in range(230)])
    assert calls == [100, 100, 30] and len(vectors) == 230

    _mock(lambda request: httpx.Response(401, json={"error": "bad key"}), monkeypatch)
    with pytest.raises(LlmError) as error:
        await EmbeddingClient(EMBEDDING_MODELS["openai"], "k").embed(["x"])
    assert error.value.status == 401 and not error.value.retryable

    _mock(lambda request: httpx.Response(200, json={"data": [{"index": 0, "embedding": [1.0, 2.0]}]}), monkeypatch)
    with pytest.raises(LlmError):
        await EmbeddingClient(EMBEDDING_MODELS["openai"], "k").embed(["x"])


def test_unknown_provider_has_no_embeddings():
    assert build_embedding_client("otro", "k") is None


def test_rrf_rewards_what_both_searches_put_on_top():
    lexical = [{"id": "a"}, {"id": "b"}, {"id": "c"}]
    semantic = [{"id": "c"}, {"id": "d"}, {"id": "a"}]

    fused = [chunk["id"] for chunk in fuse_rankings(lexical, semantic)]

    # "a" y "c" están en las dos listas; "a" más arriba en promedio.
    assert fused[:2] == ["a", "c"]
    assert set(fused) == {"a", "b", "c", "d"}
    assert fuse_rankings() == []


class FakeEmbedder:
    spec = "openai:text-embedding-3-small@768"

    def __init__(self, error: Exception | None = None):
        self.error = error
        self.texts: list[str] = []

    async def embed(self, texts):
        if self.error:
            raise self.error
        self.texts.extend(texts)
        return [_vector(1.0) for _ in texts]


LEAD = {"servicio_interes": "Hollywood Peel - Rostro"}
MESSAGES = [
    {"sender": "cliente", "content": "tengo la cara caída, ¿qué me recomiendan?"},
    {"sender": "vendedor", "content": "Hola"},
]
CATALOG = [{"id": 1, "name": "Hollywood Peel - Rostro"}]


def _chunk(chunk_id: str, content: str = "texto") -> dict:
    return {"id": chunk_id, "title": chunk_id, "content": content, "metadata": {}, "score": 0.0}


def _patch_lexical(monkeypatch):
    async def search(query, top_k, service_id=None):
        return [_chunk("lex-servicio")] if service_id else [_chunk("lex-general")]

    monkeypatch.setattr(native_provider, "search_knowledge_chunks", search)
    monkeypatch.setattr(native_provider, "service_knowledge_chunks", AsyncMock(return_value=[_chunk("primeros")]))
    monkeypatch.setattr(native_provider, "referenced_chunks", AsyncMock(return_value=[]))


async def test_copilot_combines_words_and_meaning(monkeypatch):
    _patch_lexical(monkeypatch)
    monkeypatch.setattr(native_provider, "ensure_embeddings", AsyncMock(return_value=3))
    searched = []

    async def vector_search(vector, spec, top_k, service_id=None):
        searched.append(service_id)
        return [("sem-servicio", 0.8)] if service_id else [("sem-flacidez", 0.7)]

    async def by_ids(ids, scores):
        return [_chunk(chunk_id) for chunk_id in ids]

    monkeypatch.setattr(native_provider, "vector_search", vector_search)
    monkeypatch.setattr(native_provider, "chunks_by_ids", by_ids)
    embedder = FakeEmbedder()

    knowledge, info = await native_provider.gather_knowledge(LEAD, MESSAGES, "sin descuentos", CATALOG, embedder)

    ids = [chunk["id"] for chunk in knowledge]
    # Lo del servicio primero (de las dos búsquedas), después lo general.
    assert ids[:2] == ["lex-servicio", "sem-servicio"] or ids[:2] == ["sem-servicio", "lex-servicio"]
    assert "sem-flacidez" in ids and "lex-general" in ids
    assert searched == [1, None]
    assert info == {"retrieval": "hibrida", "embedding_model": embedder.spec, "embedded_chunks": 3}
    # La consulta por significado es la frase del cliente, no palabras sueltas.
    assert embedder.texts == ["Hollywood Peel - Rostro\ntengo la cara caída, ¿qué me recomiendan?\nsin descuentos"]


async def test_copilot_keeps_searching_by_words_if_embeddings_fail(monkeypatch):
    _patch_lexical(monkeypatch)
    monkeypatch.setattr(native_provider, "ensure_embeddings", AsyncMock(side_effect=LlmError("cuota agotada")))
    monkeypatch.setattr(native_provider, "vector_search", AsyncMock(side_effect=AssertionError("no debe buscar por vector")))

    knowledge, info = await native_provider.gather_knowledge(LEAD, MESSAGES, None, CATALOG, FakeEmbedder())

    assert [chunk["id"] for chunk in knowledge] == ["lex-servicio", "lex-general"]
    assert info["retrieval"] == "palabras" and "cuota agotada" in info["embedding_error"]


async def test_without_an_embedder_retrieval_is_by_words(monkeypatch):
    _patch_lexical(monkeypatch)

    knowledge, info = await native_provider.gather_knowledge(LEAD, MESSAGES, None, CATALOG, None)

    assert [chunk["id"] for chunk in knowledge] == ["lex-servicio", "lex-general"]
    assert info == {"retrieval": "palabras"}


async def test_named_fichas_come_right_after_the_fragment_that_names_them(monkeypatch):
    """El mapa dolor → solución dice "paño → Ácido tranexámico"; la ficha del
    tratamiento entra a continuación, no al final (donde el recorte la
    dejaría afuera)."""
    _patch_lexical(monkeypatch)
    referenced = AsyncMock(return_value=[("lex-general", _chunk("ficha-tranexamico"))])
    monkeypatch.setattr(native_provider, "referenced_chunks", referenced)

    knowledge, _ = await native_provider.gather_knowledge(LEAD, MESSAGES, None, CATALOG, None)

    assert [chunk["id"] for chunk in knowledge] == ["lex-servicio", "lex-general", "ficha-tranexamico"]
    assert referenced.await_args.args[1] == native_provider.REFERENCE_TOP_K

    without, _ = await native_provider.gather_knowledge(LEAD, MESSAGES, None, CATALOG, None, follow_references=False)
    assert [chunk["id"] for chunk in without] == ["lex-servicio", "lex-general"]


def test_the_column_has_the_dimensions_the_embeddings_produce():
    from app.db.models.ai import KnowledgeChunk

    assert KnowledgeChunk.__table__.c.embedding.type.dim == DIMENSIONS
