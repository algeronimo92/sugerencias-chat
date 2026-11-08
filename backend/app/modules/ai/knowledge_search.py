"""Búsqueda por palabras en el conocimiento del negocio (schema del tenant) y
fusión con la búsqueda por significado de ``knowledge_vectors``."""

from __future__ import annotations

import unicodedata

from sqlalchemy import text

from app.db.uow import session_scope

_COLUMNS = """
        c.id,
        d.id AS document_id,
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
    -- Desempate estable (no por id, que es aleatorio): con el mismo
    -- conocimiento, la misma consulta arma siempre el mismo contexto.
    ORDER BY score DESC, d.title, c.ordinal
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
    ORDER BY d.title, c.ordinal
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


_TITLES_SQL = text("SELECT id, title FROM knowledge_documents")

_FIRST_CHUNKS_SQL = text(
    f"""
    SELECT {_COLUMNS}, 0.0 AS score
    FROM knowledge_chunks AS c
    JOIN knowledge_documents AS d ON d.id = c.document_id
    WHERE d.id = ANY(CAST(:ids AS uuid[])) AND c.ordinal = 0
    """
)

# Un nombre más corto confunde palabras comunes con tratamientos.
MIN_REFERENCE_LENGTH = 4

_BY_IDS_SQL = text(
    f"""
    SELECT {_COLUMNS}, 0.0 AS score
    FROM knowledge_chunks AS c
    JOIN knowledge_documents AS d ON d.id = c.document_id
    WHERE c.id = ANY(CAST(:ids AS uuid[]))
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


async def chunks_by_ids(ids: list[str], scores: dict[str, float] | None = None) -> list[dict]:
    """Los fragmentos en el orden de ``ids`` (el de la búsqueda por
    significado), con su similitud como ``score``."""
    if not ids:
        return []
    async with session_scope() as session:
        rows = (await session.execute(_BY_IDS_SQL, {"ids": ids})).mappings().all()
    by_id = {chunk["id"]: chunk for chunk in _rows(rows)}
    return [
        {**by_id[chunk_id], "score": (scores or {}).get(chunk_id, 0.0)}
        for chunk_id in ids if chunk_id in by_id
    ]


def _plain(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value.casefold())
    return "".join(char for char in decomposed if not unicodedata.combining(char))


def _names(title: str) -> list[str]:
    """Cómo se nombra un documento en el texto de otro: "Ficha: Ácido
    Tranexámico" → "acido tranexamico"; "Ficha: Borrado de Cejas · Borrado de
    Tatuajes" → cada uno."""
    name = title.split(":", 1)[-1]
    return [plain for part in name.split("·") if len(plain := _plain(part).strip()) >= MIN_REFERENCE_LENGTH]


async def referenced_chunks(chunks: list[dict], limit: int) -> list[tuple[str, dict]]:
    """Las fichas que nombran los fragmentos encontrados y que todavía no
    están: ``[(id del fragmento que la nombra, primer fragmento de la ficha)]``.

    Es el segundo salto que hace falta cuando el cliente habla de su problema
    y no del tratamiento: la búsqueda encuentra la entrada del mapa dolor →
    solución ("paño" → **Ácido tranexámico**) pero no la ficha, que es la que
    trae contraindicaciones y cuidados. Medido con
    ``scripts.eval_knowledge_retrieval``."""
    present = {chunk.get("document_id") for chunk in chunks}
    async with session_scope() as session:
        titles = (await session.execute(_TITLES_SQL)).all()
        wanted: dict[str, str] = {}
        for chunk in chunks:
            content = _plain(chunk.get("content") or "")
            for document_id, title in titles:
                document_id = str(document_id)
                if document_id in present or document_id in wanted:
                    continue
                if any(name in content for name in _names(title)):
                    wanted[document_id] = chunk["id"]
            if len(wanted) >= limit:
                break
        if not wanted:
            return []
        rows = (await session.execute(_FIRST_CHUNKS_SQL, {"ids": list(wanted)})).mappings().all()
    found = {chunk["document_id"]: chunk for chunk in _rows(rows)}
    return [(referrer, found[document_id]) for document_id, referrer in wanted.items() if document_id in found]


def fuse_rankings(*rankings: list[dict], k: int = 60) -> list[dict]:
    """Reciprocal Rank Fusion (Cormack et al., SIGIR 2009): cada lista aporta
    ``1 / (k + posición)`` por fragmento. Combina rankings de escalas que no se
    pueden comparar (``ts_rank_cd`` contra similitud coseno) mirando solo el
    orden, y premia lo que aparece arriba en varias listas. k=60 es el valor
    del trabajo original y el que usa casi todo el mundo."""
    scores: dict[str, float] = {}
    chunks: dict[str, dict] = {}
    for ranking in rankings:
        for position, chunk in enumerate(ranking, start=1):
            scores[chunk["id"]] = scores.get(chunk["id"], 0.0) + 1.0 / (k + position)
            chunks.setdefault(chunk["id"], chunk)
    ordered = sorted(scores, key=lambda chunk_id: scores[chunk_id], reverse=True)
    return [chunks[chunk_id] for chunk_id in ordered]


def _rows(rows) -> list[dict]:
    return [
        {
            "id": str(row["id"]),
            "document_id": str(row["document_id"]),
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
