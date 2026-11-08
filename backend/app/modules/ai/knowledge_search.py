"""Tenant-scoped lexical retrieval for the RAG workflow."""

from __future__ import annotations

from sqlalchemy import text

from app.db.uow import session_scope

_COLUMNS = """
        c.id,
        d.title,
        d.source,
        c.content,
        d.metadata AS document_metadata,
        c.metadata AS chunk_metadata,
        d.service_id,
        d.document_type
"""

_LEXICAL_SQL = text(
    f"""
    SELECT {_COLUMNS},
        ts_rank_cd(
            to_tsvector('spanish'::regconfig, c.content),
            websearch_to_tsquery('spanish'::regconfig, :query)
        )
        + 0.5 * ts_rank_cd(
            to_tsvector('spanish'::regconfig, d.title),
            websearch_to_tsquery('spanish'::regconfig, :query)
        ) AS score
    FROM knowledge_chunks AS c
    JOIN knowledge_documents AS d ON d.id = c.document_id
    WHERE (
        to_tsvector('spanish'::regconfig, c.content) @@ websearch_to_tsquery('spanish'::regconfig, :query)
        -- Un párrafo de la ficha "Hollywood Peel" que no repite el nombre
        -- también tiene que aparecer al buscar el servicio.
        OR to_tsvector('spanish'::regconfig, d.title) @@ websearch_to_tsquery('spanish'::regconfig, :query)
    )
      AND (CAST(:service_id AS integer) IS NULL OR d.service_id = CAST(:service_id AS integer))
    ORDER BY score DESC, c.id
    LIMIT :top_k
    """
)

_FALLBACK_SQL = text(
    f"""
    SELECT {_COLUMNS}, 0.0 AS score
    FROM knowledge_chunks AS c
    JOIN knowledge_documents AS d ON d.id = c.document_id
    WHERE (c.content ILIKE :pattern ESCAPE '\\'
       OR d.title ILIKE :pattern ESCAPE '\\')
      AND (CAST(:service_id AS integer) IS NULL OR d.service_id = CAST(:service_id AS integer))
    ORDER BY c.id
    LIMIT :top_k
    """
)

# Los primeros fragmentos de los documentos de un servicio, para cuando la
# conversación todavía no dice nada que buscar ("hola, info del peel").
_SERVICE_SQL = text(
    f"""
    SELECT {_COLUMNS}, 0.0 AS score
    FROM knowledge_chunks AS c
    JOIN knowledge_documents AS d ON d.id = c.document_id
    WHERE d.service_id = :service_id
    ORDER BY CASE d.document_type WHEN 'ficha' THEN 0 WHEN 'faq' THEN 1 ELSE 2 END,
             c.ordinal, d.updated_at DESC, c.id
    LIMIT :top_k
    """
)


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def search_knowledge_chunks(query: str, top_k: int, service_id: int | None = None) -> list[dict]:
    """Search only the knowledge tables selected by the current tenant session.
    Con ``service_id`` busca solo en los documentos de ese servicio."""

    params = {"query": query, "top_k": top_k, "service_id": service_id}
    async with session_scope() as session:
        rows = (await session.execute(_LEXICAL_SQL, params)).mappings().all()
        if not rows:
            rows = (
                await session.execute(
                    _FALLBACK_SQL,
                    {"pattern": f"%{_escape_like(query)}%", "top_k": top_k, "service_id": service_id},
                )
            ).mappings().all()
    return _rows(rows)


async def service_knowledge_chunks(service_id: int, top_k: int) -> list[dict]:
    """Fichas primero y en su orden: lo básico del servicio, sin consulta."""
    async with session_scope() as session:
        rows = (
            await session.execute(_SERVICE_SQL, {"service_id": service_id, "top_k": top_k})
        ).mappings().all()
    return _rows(rows)


def _rows(rows) -> list[dict]:
    return [
        {
            "id": str(row["id"]),
            "title": row["title"],
            "source": row["source"],
            "content": row["content"],
            "service_id": row["service_id"],
            "document_type": row["document_type"],
            "metadata": {
                **(row["document_metadata"] or {}),
                **(row["chunk_metadata"] or {}),
            },
            "score": float(row["score"] or 0),
        }
        for row in rows
    ]
