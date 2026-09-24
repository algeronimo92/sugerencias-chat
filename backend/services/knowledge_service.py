"""Documentos de conocimiento que cada negocio carga para el asistente IA.

El negocio edita el texto completo del documento; los fragmentos que consulta
``/api/webhooks/rag-search`` (ver services/knowledge_search.py) se derivan de
ese texto y se regeneran enteros en cada edición, nunca por separado.
"""

from __future__ import annotations

import re

from sqlalchemy import delete, func, select

from db.models import KnowledgeChunk, KnowledgeDocument
from db.session import get_sessionmaker

MAX_TITLE_LENGTH = 200
MAX_CONTENT_LENGTH = 100_000
MAX_DOCUMENTS = 200
# Fragmentos del tamaño de una ficha o un párrafo largo: la búsqueda es
# lexical, y un fragmento enorme empataría con casi cualquier consulta.
CHUNK_TARGET_CHARS = 1200
CHUNK_OVERLAP_CHARS = 150

_SENTENCE_END_RE = re.compile(r"(?<=[.!?])\s+")


class KnowledgeLimitError(Exception):
    pass


def _hard_split(text: str, size: int) -> list[str]:
    parts = []
    for sentence in _SENTENCE_END_RE.split(text):
        while len(sentence) > size:
            cut = sentence.rfind(" ", 0, size)
            cut = cut if cut > size // 2 else size
            parts.append(sentence[:cut].strip())
            sentence = sentence[cut:].strip()
        if sentence:
            parts.append(sentence)
    return parts


def chunk_text(
    content: str,
    *,
    target: int = CHUNK_TARGET_CHARS,
    overlap: int = CHUNK_OVERLAP_CHARS,
) -> list[str]:
    """Agrupa párrafos hasta ``target`` caracteres.

    Un párrafo más largo que ``target`` se parte por oraciones. Cada fragmento
    arranca con la cola del anterior para que una idea cortada en el borde
    siga encontrándose desde cualquiera de los dos.
    """

    paragraphs = [
        " ".join(block.split())
        for block in re.split(r"\n\s*\n", content.replace("\r\n", "\n"))
    ]
    pieces: list[str] = []
    for paragraph in paragraphs:
        if not paragraph:
            continue
        pieces.extend(_hard_split(paragraph, target) if len(paragraph) > target else [paragraph])

    chunks: list[str] = []
    current = ""
    for piece in pieces:
        candidate = f"{current}\n\n{piece}" if current else piece
        if current and len(candidate) > target:
            chunks.append(current)
            tail = current[-overlap:]
            tail = tail[tail.find(" ") + 1:] if " " in tail else tail
            current = f"{tail} {piece}".strip() if overlap else piece
        else:
            current = candidate
    if current:
        chunks.append(current)
    return chunks


def _validate(title: str, content: str) -> tuple[str, str]:
    title = " ".join(title.split())
    content = content.replace("\r\n", "\n").strip()
    if not title:
        raise ValueError("El título es obligatorio")
    if len(title) > MAX_TITLE_LENGTH:
        raise ValueError(f"El título supera los {MAX_TITLE_LENGTH} caracteres")
    if not content:
        raise ValueError("El documento no tiene texto")
    if len(content) > MAX_CONTENT_LENGTH:
        raise ValueError(f"El documento supera los {MAX_CONTENT_LENGTH} caracteres")
    return title, content


def _summary(document: KnowledgeDocument, chunk_count: int) -> dict:
    return {
        "id": str(document.id),
        "title": document.title,
        "document_type": document.document_type,
        "characters": len(document.content or ""),
        "chunk_count": chunk_count,
        "created_at": document.created_at.isoformat().replace("+00:00", "Z"),
        "updated_at": document.updated_at.isoformat().replace("+00:00", "Z"),
    }


async def list_documents() -> list[dict]:
    chunk_counts = (
        select(KnowledgeChunk.document_id, func.count().label("chunk_count"))
        .group_by(KnowledgeChunk.document_id)
        .subquery()
    )
    async with get_sessionmaker()() as session:
        rows = (
            await session.execute(
                select(KnowledgeDocument, func.coalesce(chunk_counts.c.chunk_count, 0))
                .outerjoin(chunk_counts, chunk_counts.c.document_id == KnowledgeDocument.id)
                .order_by(KnowledgeDocument.updated_at.desc())
            )
        ).all()
    return [_summary(document, int(count)) for document, count in rows]


async def get_document(document_id: str) -> dict | None:
    async with get_sessionmaker()() as session:
        document = await session.get(KnowledgeDocument, document_id)
        if document is None:
            return None
        count = await session.scalar(
            select(func.count()).where(KnowledgeChunk.document_id == document_id)
        )
        return {**_summary(document, int(count or 0)), "content": document.content or ""}


def _chunk_rows(document_id: str, content: str) -> list[KnowledgeChunk]:
    return [
        KnowledgeChunk(document_id=document_id, content=chunk, ordinal=ordinal)
        for ordinal, chunk in enumerate(chunk_text(content))
    ]


async def create_document(title: str, content: str, document_type: str | None = None) -> dict:
    title, content = _validate(title, content)
    async with get_sessionmaker()() as session:
        existing = await session.scalar(select(func.count()).select_from(KnowledgeDocument))
        if (existing or 0) >= MAX_DOCUMENTS:
            raise KnowledgeLimitError(f"Se alcanzó el máximo de {MAX_DOCUMENTS} documentos")
        document = KnowledgeDocument(
            title=title, content=content, document_type=document_type, source="manual"
        )
        session.add(document)
        await session.flush()
        session.add_all(_chunk_rows(document.id, content))
        await session.commit()
        document_id = str(document.id)
    created = await get_document(document_id)
    assert created is not None
    return created


async def update_document(document_id: str, title: str, content: str) -> dict | None:
    title, content = _validate(title, content)
    async with get_sessionmaker()() as session:
        document = await session.get(KnowledgeDocument, document_id, with_for_update=True)
        if document is None:
            return None
        document.title = title
        document.content = content
        document.updated_at = func.now()
        await session.execute(
            delete(KnowledgeChunk).where(KnowledgeChunk.document_id == document_id)
        )
        session.add_all(_chunk_rows(document_id, content))
        await session.commit()
    return await get_document(document_id)


async def delete_document(document_id: str) -> bool:
    async with get_sessionmaker()() as session:
        result = await session.execute(
            delete(KnowledgeDocument)
            .where(KnowledgeDocument.id == document_id)
            .returning(KnowledgeDocument.id)
        )
        deleted = result.scalar_one_or_none() is not None
        await session.commit()
    return deleted
