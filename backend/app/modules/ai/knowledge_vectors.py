"""Búsqueda por significado en el conocimiento del negocio (pgvector).

La búsqueda por palabras (``knowledge_search``) no relaciona "tengo la cara
caída" con una ficha que dice "flacidez"; los embeddings sí. Las dos se
combinan con RRF en el armado del contexto del copiloto.

La similitud se calcula en PostgreSQL, en la tabla del schema del negocio que
pide la sugerencia: el backend no guarda vectores en memoria (con un schema
por empresa, eso crecería con cada empresa) y la búsqueda de una clínica nunca
toca los vectores de otra. Sin índice: recorrido exacto, que con unos miles de
fragmentos tarda milisegundos y no pierde resultados al filtrar por servicio.

Los vectores se calculan tarde, no al guardar: guardar un documento no depende
de que la API de IA responda, y el mismo camino completa lo que falta después
de un despliegue, de importar plantillas o de cambiar de proveedor (vectores
de otro modelo no se comparan; se recalculan).
"""

from __future__ import annotations

from sqlalchemy import or_, select, text, update

from app.db.models.ai import KnowledgeChunk, KnowledgeDocument
from app.db.uow import session_scope
from app.integrations.llm.embeddings import EmbeddingClient

# Tope por sugerencia: cubre de una vez la biblioteca de plantillas (unos
# 150 fragmentos) y acota la demora si alguien importa 200 documentos juntos;
# lo que quede se completa en las siguientes.
MAX_EMBED_PER_CALL = 200

# ``<=>`` es la distancia coseno; los vectores llegan normalizados, así que
# 1 - distancia es la similitud. El vector de la consulta viaja como texto
# ('[0.1,...]') y se convierte acá: asyncpg no conoce el tipo ``vector``.
_SEARCH_SQL = text(
    """
    SELECT c.id, 1 - (c.embedding <=> CAST(CAST(:query AS text) AS vector)) AS similarity
    FROM knowledge_chunks AS c
    JOIN knowledge_documents AS d ON d.id = c.document_id
    WHERE c.embedding_model = :spec
      AND c.embedding IS NOT NULL
      AND (CAST(:service_id AS integer) IS NULL OR EXISTS (
            SELECT 1 FROM knowledge_document_services AS ds
            WHERE ds.document_id = d.id AND ds.service_id = CAST(:service_id AS integer)))
    ORDER BY c.embedding <=> CAST(CAST(:query AS text) AS vector), c.id
    LIMIT :top_k
    """
)


def embedding_text(title: str, content: str) -> str:
    """El título va con el fragmento: un párrafo de la ficha de Botox que no
    repite "Botox" igual tiene que quedar cerca de una pregunta por Botox."""
    return f"{title}\n\n{content}"


def _literal(vector: list[float]) -> str:
    return "[" + ",".join(repr(float(value)) for value in vector) + "]"


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


async def vector_search(
    query_vector: list[float], spec: str, top_k: int, service_id: int | None = None,
) -> list[tuple[str, float]]:
    """``[(chunk_id, similitud)]`` de mayor a menor, solo entre los vectores
    del mismo modelo que el de la consulta."""
    async with session_scope() as session:
        rows = (await session.execute(_SEARCH_SQL, {
            "query": _literal(query_vector), "spec": spec, "service_id": service_id, "top_k": top_k,
        })).all()
    return [(str(chunk_id), float(similarity)) for chunk_id, similarity in rows]
