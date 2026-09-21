"""Tenant-scoped lexical retrieval for the RAG workflow."""

from __future__ import annotations

from sqlalchemy import text

from db.session import get_sessionmaker


_LEXICAL_SQL = text(
    """
    SELECT
        c.id,
        d.title,
        d.source,
        c.content,
        d.metadata AS document_metadata,
        c.metadata AS chunk_metadata,
        ts_rank_cd(
            to_tsvector('spanish'::regconfig, c.content),
            websearch_to_tsquery('spanish'::regconfig, :query)
        ) AS score
    FROM knowledge_chunks AS c
    JOIN knowledge_documents AS d ON d.id = c.document_id
    WHERE to_tsvector('spanish'::regconfig, c.content)
          @@ websearch_to_tsquery('spanish'::regconfig, :query)
    ORDER BY score DESC, c.id
    LIMIT :top_k
    """
)

_FALLBACK_SQL = text(
    """
    SELECT
        c.id,
        d.title,
        d.source,
        c.content,
        d.metadata AS document_metadata,
        c.metadata AS chunk_metadata,
        0.0 AS score
    FROM knowledge_chunks AS c
    JOIN knowledge_documents AS d ON d.id = c.document_id
    WHERE c.content ILIKE :pattern ESCAPE '\\'
       OR d.title ILIKE :pattern ESCAPE '\\'
    ORDER BY c.id
    LIMIT :top_k
    """
)


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def search_knowledge_chunks(query: str, top_k: int) -> list[dict]:
    """Search only the knowledge tables selected by the current tenant session."""

    async with get_sessionmaker()() as session:
        rows = (
            await session.execute(_LEXICAL_SQL, {"query": query, "top_k": top_k})
        ).mappings().all()
        if not rows:
            rows = (
                await session.execute(
                    _FALLBACK_SQL,
                    {"pattern": f"%{_escape_like(query)}%", "top_k": top_k},
                )
            ).mappings().all()

    return [
        {
            "id": str(row["id"]),
            "title": row["title"],
            "source": row["source"],
            "content": row["content"],
            "metadata": {
                **(row["document_metadata"] or {}),
                **(row["chunk_metadata"] or {}),
            },
            "score": float(row["score"] or 0),
        }
        for row in rows
    ]
