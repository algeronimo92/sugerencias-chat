"""Atomic document/chunk persistence; receives validated text and prepared chunks."""
from sqlalchemy import delete, func, select
from app.db.models.ai import KnowledgeChunk, KnowledgeDocument
from app.modules.ai.errors import KnowledgeLimitError
from app.db.uow import session_scope

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
    async with session_scope() as session:
        rows = (
            await session.execute(
                select(KnowledgeDocument, func.coalesce(chunk_counts.c.chunk_count, 0))
                .outerjoin(chunk_counts, chunk_counts.c.document_id == KnowledgeDocument.id)
                .order_by(KnowledgeDocument.updated_at.desc())
            )
        ).all()
    return [_summary(document, int(count)) for document, count in rows]

async def get_document(document_id: str) -> dict | None:
    async with session_scope() as session:
        document = await session.get(KnowledgeDocument, document_id)
        if document is None:
            return None
        count = await session.scalar(
            select(func.count()).where(KnowledgeChunk.document_id == document_id)
        )
        return {**_summary(document, int(count or 0)), "content": document.content or ""}

def _chunk_rows(document_id: str, chunks: list[str]) -> list[KnowledgeChunk]:
    return [
        KnowledgeChunk(document_id=document_id, content=chunk, ordinal=ordinal)
        for ordinal, chunk in enumerate(chunks)
    ]

async def create_document(title: str, content: str, document_type: str | None, chunks: list[str], max_documents: int) -> dict:
    async with session_scope() as session:
        existing = await session.scalar(select(func.count()).select_from(KnowledgeDocument))
        if (existing or 0) >= max_documents:
            raise KnowledgeLimitError(f"Se alcanzó el máximo de {max_documents} documentos")
        document = KnowledgeDocument(
            title=title, content=content, document_type=document_type, source="manual"
        )
        session.add(document)
        await session.flush()
        session.add_all(_chunk_rows(document.id, chunks))
        await session.flush()
        document_id = str(document.id)
    created = await get_document(document_id)
    assert created is not None
    return created

async def update_document(document_id: str, title: str, content: str, chunks: list[str]) -> dict | None:
    async with session_scope() as session:
        document = await session.get(KnowledgeDocument, document_id, with_for_update=True)
        if document is None:
            return None
        document.title = title
        document.content = content
        document.updated_at = func.now()
        await session.execute(
            delete(KnowledgeChunk).where(KnowledgeChunk.document_id == document_id)
        )
        session.add_all(_chunk_rows(document_id, chunks))
        await session.flush()
    return await get_document(document_id)

async def delete_document(document_id: str) -> bool:
    async with session_scope() as session:
        result = await session.execute(
            delete(KnowledgeDocument)
            .where(KnowledgeDocument.id == document_id)
            .returning(KnowledgeDocument.id)
        )
        deleted = result.scalar_one_or_none() is not None
        await session.flush()
    return deleted
