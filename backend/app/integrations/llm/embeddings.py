"""Embeddings para la búsqueda por significado del conocimiento del negocio.

Un solo cliente para los dos proveedores: OpenAI y Gemini exponen el mismo
``/embeddings`` (el de Gemini es su endpoint compatible con OpenAI y acepta la
misma clave del negocio como Bearer). Verificado contra las dos APIs el
2026-11-08 con ``dimensions=768``.

768 dimensiones en los dos: alcanza para un corpus de fichas de una clínica,
y guardar y comparar vectores de 1536 o 3072 cuesta el doble o el cuádruple
sin una mejora que se note en documentos de este tamaño. Los vectores se
normalizan acá: ``gemini-embedding-001`` no los devuelve normalizados con
menos dimensiones que las nativas, y la similitud se calcula como producto
punto.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import httpx

from app.integrations.llm.base import LlmError

DIMENSIONS = 768
TIMEOUT_SECONDS = 20.0
# Lo que cada API acepta por llamada (OpenAI permite 2048; Gemini, 100).
BATCH_SIZE = 100


@dataclass(frozen=True)
class EmbeddingModel:
    provider: str
    model: str
    base_url: str

    @property
    def spec(self) -> str:
        """Qué generó un vector: vectores de modelos o dimensiones distintas
        no se pueden comparar entre sí."""
        return f"{self.provider}:{self.model}@{DIMENSIONS}"


EMBEDDING_MODELS: dict[str, EmbeddingModel] = {
    "openai": EmbeddingModel("openai", "text-embedding-3-small", "https://api.openai.com/v1"),
    "gemini": EmbeddingModel("gemini", "gemini-embedding-2", "https://generativelanguage.googleapis.com/v1beta/openai"),
}


def _normalize(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vector))
    return [value / norm for value in vector] if norm else vector


class EmbeddingClient:
    def __init__(self, model: EmbeddingModel, api_key: str) -> None:
        self.model = model
        self._api_key = api_key

    @property
    def spec(self) -> str:
        return self.model.spec

    async def embed(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            for start in range(0, len(texts), BATCH_SIZE):
                vectors.extend(await self._batch(client, texts[start:start + BATCH_SIZE]))
        return vectors

    async def _batch(self, client: httpx.AsyncClient, texts: list[str]) -> list[list[float]]:
        try:
            response = await client.post(
                f"{self.model.base_url}/embeddings",
                json={"model": self.model.model, "input": texts, "dimensions": DIMENSIONS},
                headers={"Authorization": f"Bearer {self._api_key}"},
            )
        except httpx.HTTPError as exc:
            raise LlmError(f"No se pudo conectar para calcular embeddings ({self.model.provider}): {exc}") from exc
        if response.status_code >= 400:
            raise LlmError(
                f"{self.model.provider} respondió {response.status_code} al calcular embeddings: {response.text[:200]}",
                status=response.status_code,
                retryable=response.status_code not in (400, 401, 403, 404),
            )
        payload = response.json()
        # El endpoint de Gemini a veces envuelve la respuesta en una lista.
        if isinstance(payload, list) and payload:
            payload = payload[0]
        try:
            items = sorted(payload["data"], key=lambda item: item.get("index", 0))
            vectors = [_normalize([float(value) for value in item["embedding"]]) for item in items]
        except (KeyError, TypeError, ValueError) as exc:
            raise LlmError(f"{self.model.provider} devolvió embeddings con un formato inesperado") from exc
        if len(vectors) != len(texts) or any(len(vector) != DIMENSIONS for vector in vectors):
            raise LlmError(f"{self.model.provider} devolvió {len(vectors)} embeddings para {len(texts)} textos")
        return vectors


def build_embedding_client(provider: str, api_key: str) -> EmbeddingClient | None:
    model = EMBEDDING_MODELS.get(provider)
    return EmbeddingClient(model, api_key) if model else None
