"""Atomic document/chunk persistence; receives validated text and prepared chunks."""
from sqlalchemy import delete, func, select
from sqlalchemy.exc import IntegrityError
from app.db.models.ai import KnowledgeChunk, KnowledgeDocument, KnowledgeDocumentService
from app.modules.ai.errors import KnowledgeLimitError
from app.db.uow import session_scope

def _summary(document: KnowledgeDocument, chunk_count: int, service_ids: list[int]) -> dict:
    return {
        "id": str(document.id),
        "title": document.title,
        "document_type": document.document_type,
        "service_ids": service_ids,
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
        links = await _service_links(session)
    return [_summary(document, int(count), links.get(str(document.id), [])) for document, count in rows]

async def _service_links(session, document_id: str | None = None) -> dict[str, list[int]]:
    """Servicios de cada documento (o de uno), en orden de id."""
    query = select(KnowledgeDocumentService.document_id, KnowledgeDocumentService.service_id).order_by(
        KnowledgeDocumentService.document_id, KnowledgeDocumentService.service_id,
    )
    if document_id is not None:
        query = query.where(KnowledgeDocumentService.document_id == document_id)
    links: dict[str, list[int]] = {}
    for doc_id, service_id in (await session.execute(query)).all():
        links.setdefault(str(doc_id), []).append(int(service_id))
    return links

async def _set_services(session, document: KnowledgeDocument, service_ids: list[int]) -> None:
    """Reemplaza los vínculos. ``service_id`` queda como espejo del primero
    para la versión anterior (ver el modelo)."""
    await session.execute(
        delete(KnowledgeDocumentService).where(KnowledgeDocumentService.document_id == document.id)
    )
    session.add_all(KnowledgeDocumentService(document_id=document.id, service_id=service_id) for service_id in service_ids)
    document.service_id = service_ids[0] if service_ids else None
    try:
        async with session.begin_nested():
            await session.flush()
    except IntegrityError as exc:
        raise UnknownServiceError("Uno de los servicios elegidos no existe") from exc

async def get_document(document_id: str) -> dict | None:
    async with session_scope() as session:
        document = await session.get(KnowledgeDocument, document_id)
        if document is None:
            return None
        count = await session.scalar(
            select(func.count()).where(KnowledgeChunk.document_id == document_id)
        )
        links = await _service_links(session, document_id)
        return {**_summary(document, int(count or 0), links.get(document_id, [])), "content": document.content or ""}

def _chunk_rows(document_id: str, chunks: list[str]) -> list[KnowledgeChunk]:
    return [
        KnowledgeChunk(document_id=document_id, content=chunk, ordinal=ordinal)
        for ordinal, chunk in enumerate(chunks)
    ]

class UnknownServiceError(ValueError):
    pass


async def create_document(
    title: str, content: str, document_type: str | None, chunks: list[str], max_documents: int,
    *, service_ids: list[int] | None = None, source: str = "manual", metadata: dict | None = None,
    chunker_version: int | None = None,
) -> dict:
    async with session_scope() as session:
        existing = await session.scalar(select(func.count()).select_from(KnowledgeDocument))
        if (existing or 0) >= max_documents:
            raise KnowledgeLimitError(f"Se alcanzó el máximo de {max_documents} documentos")
        document = KnowledgeDocument(
            title=title, content=content, document_type=document_type, source=source,
            metadata_=_with_chunker(metadata, chunker_version),
        )
        session.add(document)
        await session.flush()
        await _set_services(session, document, service_ids or [])
        session.add_all(_chunk_rows(document.id, chunks))
        await session.flush()
        document_id = str(document.id)
    created = await get_document(document_id)
    assert created is not None
    return created

def _with_chunker(metadata: dict | None, chunker_version: int | None) -> dict:
    """Con qué versión del troceador se armaron los fragmentos, para
    rehacerlos cuando cambie (ver ``knowledge_service.CHUNKER_VERSION``)."""
    merged = dict(metadata or {})
    if chunker_version is not None:
        merged["chunker"] = chunker_version
    return merged


async def _replace_chunks(session, document: KnowledgeDocument, chunks: list[str], chunker_version: int | None) -> None:
    document.metadata_ = _with_chunker(document.metadata_, chunker_version)
    await session.execute(
        delete(KnowledgeChunk).where(KnowledgeChunk.document_id == document.id)
    )
    session.add_all(_chunk_rows(document.id, chunks))
    await session.flush()


async def update_document(
    document_id: str, title: str, content: str, chunks: list[str],
    *, document_type: str | None = None, service_ids: list[int] | None = None,
    chunker_version: int | None = None,
) -> dict | None:
    async with session_scope() as session:
        document = await session.get(KnowledgeDocument, document_id, with_for_update=True)
        if document is None:
            return None
        document.title = title
        document.content = content
        document.document_type = document_type
        document.updated_at = func.now()
        await _set_services(session, document, service_ids or [])
        await _replace_chunks(session, document, chunks, chunker_version)
    return await get_document(document_id)


async def documents_chunked_before(chunker_version: int) -> list[tuple[str, str]]:
    """(id, texto) de los documentos cuyos fragmentos armó un troceador
    anterior (o ninguno registrado)."""
    async with session_scope() as session:
        rows = (await session.execute(
            select(KnowledgeDocument.id, KnowledgeDocument.content)
            .where(func.coalesce(KnowledgeDocument.metadata_["chunker"].as_integer(), 0) < chunker_version)
            .order_by(KnowledgeDocument.created_at)
        )).all()
    return [(str(document_id), content or "") for document_id, content in rows]


async def replace_chunks(document_id: str, chunks: list[str], chunker_version: int) -> None:
    """Fragmentos nuevos para el mismo texto: el documento no cambia, solo
    cómo se busca en él."""
    async with session_scope() as session:
        document = await session.get(KnowledgeDocument, document_id, with_for_update=True)
        if document is not None:
            await _replace_chunks(session, document, chunks, chunker_version)

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
            .join(KnowledgeDocumentService, KnowledgeDocumentService.document_id == KnowledgeDocument.id)
            .where(KnowledgeDocumentService.service_id == service_id).order_by(KnowledgeDocument.title)
        )).all()
    return [(str(row.id), row.title) for row in rows]
