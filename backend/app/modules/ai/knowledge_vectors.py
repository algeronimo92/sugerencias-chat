"""Búsqueda por significado en el conocimiento del negocio.

La búsqueda por palabras (``knowledge_search``) no relaciona "tengo la cara
caída" con una ficha que dice "flacidez"; los embeddings sí. Las dos se
combinan con RRF en el armado del contexto del copiloto.

Sin pgvector: la imagen de PostgreSQL de producción no trae la extensión, y un
negocio tiene a lo sumo unos miles de fragmentos (200 documentos). Los
vectores viven en ``knowledge_chunks.embedding`` y la similitud se calcula acá
contra una matriz en memoria por schema, que se recarga solo cuando cambian
los fragmentos. Si el corpus creciera a cientos de miles, esto se reemplaza
por pgvector sin tocar a quien llama.

Los vectores se calculan tarde, no al guardar: guardar un documento no depende
de que la API de IA responda, y el mismo camino completa lo que falta después
de un despliegue, de importar plantillas o de cambiar de proveedor (vectores
de otro modelo no se comparan; se recalculan).
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import numpy as np
from sqlalchemy import func, or_, select, update

from app.db.models.ai import KnowledgeChunk, KnowledgeDocument
from app.db.uow import session_scope
from app.integrations.llm.embeddings import EmbeddingClient

logger = logging.getLogger(__name__)

# Tope por sugerencia: cubre de una vez la biblioteca de plantillas (unos
# 150 fragmentos) y acota la demora si alguien importa 200 documentos juntos;
# lo que quede se completa en las siguientes.
MAX_EMBED_PER_CALL = 200


@dataclass
class _Index:
    version: tuple
    ids: list[str]
    service_ids: np.ndarray
    matrix: np.ndarray


# Por schema y modelo de embeddings. Cada proceso tiene la suya; la versión
# (cuántos fragmentos tienen vector y el último cambio) detecta lo que otro
# proceso escribió.
_indexes: dict[tuple[str, str], _Index] = {}


def embedding_text(title: str, content: str) -> str:
    """El título va con el fragmento: un párrafo de la ficha de Botox que no
    repite "Botox" igual tiene que quedar cerca de una pregunta por Botox."""
    return f"{title}\n\n{content}"


async def ensure_embeddings(client: EmbeddingClient) -> int:
    """Calcula los vectores que faltan o que generó otro modelo. Devuelve
    cuántos calculó. Levanta ``LlmError`` si la API falla."""
    async with session_scope() as session:
        pending = (await session.execute(
            select(KnowledgeChunk.id, KnowledgeDocument.title, KnowledgeChunk.content)
            .join(KnowledgeDocument, KnowledgeDocument.id == KnowledgeChunk.document_id)
            .where(or_(KnowledgeChunk.embedding_model.is_(None), KnowledgeChunk.embedding_model != client.spec))
            .order_by(KnowledgeChunk.document_id, KnowledgeChunk.ordinal)
            .limit(MAX_EMBED_PER_CALL)
        )).all()
    if not pending:
        return 0
    vectors = await client.embed([embedding_text(title, content) for _, title, content in pending])
    async with session_scope() as session:
        for (chunk_id, _, _), vector in zip(pending, vectors):
            await session.execute(
                update(KnowledgeChunk)
                .where(KnowledgeChunk.id == chunk_id)
                .values(embedding=vector, embedding_model=client.spec)
            )
    return len(pending)


async def _load_index(spec: str) -> _Index | None:
    async with session_scope() as session:
        schema, count, last_change = (await session.execute(
            select(func.current_schema(), func.count(), func.max(KnowledgeChunk.updated_at))
            .select_from(KnowledgeChunk)
            .where(KnowledgeChunk.embedding_model == spec)
        )).one()
        if not count:
            return None
        key, version = (schema, spec), (count, last_change)
        cached = _indexes.get(key)
        if cached is not None and cached.version == version:
            return cached
        rows = (await session.execute(
            select(KnowledgeChunk.id, KnowledgeDocument.service_id, KnowledgeChunk.embedding)
            .join(KnowledgeDocument, KnowledgeDocument.id == KnowledgeChunk.document_id)
            .where(KnowledgeChunk.embedding_model == spec)
        )).all()
    index = _Index(
        version=version,
        ids=[str(row[0]) for row in rows],
        service_ids=np.array([row[1] if row[1] is not None else -1 for row in rows], dtype=np.int64),
        matrix=np.array([row[2] for row in rows], dtype=np.float32),
    )
    _indexes[key] = index
    return index


async def vector_search(
    query_vector: list[float], spec: str, top_k: int, service_id: int | None = None,
) -> list[tuple[str, float]]:
    """``[(chunk_id, similitud)]`` de mayor a menor. Los vectores vienen
    normalizados: el producto punto es la similitud coseno."""
    index = await _load_index(spec)
    if index is None:
        return []
    scores = index.matrix @ np.asarray(query_vector, dtype=np.float32)
    if service_id is not None:
        scores = np.where(index.service_ids == service_id, scores, -np.inf)
    count = min(top_k, int(np.isfinite(scores).sum()))
    if count <= 0:
        return []
    best = np.argpartition(-scores, count - 1)[:count]
    best = best[np.argsort(-scores[best])]
    return [(index.ids[i], float(scores[i])) for i in best]
