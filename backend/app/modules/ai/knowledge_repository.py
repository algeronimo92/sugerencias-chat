"""Atomic document/chunk persistence; receives validated text and prepared chunks."""
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from app.db.models.ai import KnowledgeChunk, KnowledgeDocument
from app.modules.ai.errors import KnowledgeLimitError
from app.db.uow import session_scope

def _summary(document: KnowledgeDocument, chunk_count: int) -> dict:
    return {
        "id": str(document.id),
        "title": document.title,
        "document_type": document.document_type,
        "service_id": document.service_id,
        # De qué plantilla de la plataforma se importó; la copia es del
        # negocio y no cambia aunque la plantilla se edite después.
        "template_id": (document.metadata_ or {}).get("template_id"),
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

class UnknownServiceError(ValueError):
    pass


async def create_document(
    title: str, content: str, document_type: str | None, chunks: list[str], max_documents: int,
    *, service_id: int | None = None, source: str = "manual", metadata: dict | None = None,
) -> dict:
    async with session_scope() as session:
        existing = await session.scalar(select(func.count()).select_from(KnowledgeDocument))
        if (existing or 0) >= max_documents:
            raise KnowledgeLimitError(f"Se alcanzó el máximo de {max_documents} documentos")
        document = KnowledgeDocument(
            title=title, content=content, document_type=document_type, source=source, service_id=service_id,
            metadata_=metadata or {},
        )
        session.add(document)
        try:
            async with session.begin_nested():
                await session.flush()
        except IntegrityError as exc:
            raise UnknownServiceError("El servicio elegido no existe") from exc
        session.add_all(_chunk_rows(document.id, chunks))
        await session.flush()
        document_id = str(document.id)
    created = await get_document(document_id)
    assert created is not None
    return created

async def update_document(
    document_id: str, title: str, content: str, chunks: list[str],
    *, document_type: str | None = None, service_id: int | None = None,
) -> dict | None:
    async with session_scope() as session:
        document = await session.get(KnowledgeDocument, document_id, with_for_update=True)
        if document is None:
            return None
        document.title = title
        document.content = content
        document.document_type = document_type
        document.service_id = service_id
        document.updated_at = func.now()
        try:
            async with session.begin_nested():
                await session.flush()
        except IntegrityError as exc:
            raise UnknownServiceError("El servicio elegido no existe") from exc
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


async def imported_template_ids() -> set[int]:
    async with session_scope() as session:
        rows = (
            await session.execute(
                select(KnowledgeDocument.metadata_["template_id"].astext).where(
                    KnowledgeDocument.metadata_.has_key("template_id")
                )
            )
        ).scalars().all()
    return {int(value) for value in rows if value and value.isdigit()}


async def documents_for_service(service_id: int) -> list[tuple[str, str]]:
    """(id, título) de los documentos vinculados al servicio, por título."""
    async with session_scope() as session:
        rows = (await session.execute(
            select(KnowledgeDocument.id, KnowledgeDocument.title)
            .where(KnowledgeDocument.service_id == service_id).order_by(KnowledgeDocument.title)
        )).all()
    return [(str(row.id), row.title) for row in rows]
