"""El conocimiento contra PostgreSQL real: los fragmentos se rehacen cuando
cambia el troceador, y el servicio de interés se busca sin su zona."""

from __future__ import annotations

from sqlalchemy import select, update

from app.db.models.ai import KnowledgeChunk, KnowledgeDocument
from app.db.uow import session_scope
from app.modules.ai.infrastructure.native_provider import service_query
from app.modules.ai.knowledge_search import search_knowledge_chunks
from app.modules.ai.knowledge_service import CHUNKER_VERSION, create_document, rechunk_outdated_documents
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401


async def test_documents_chunked_by_an_older_chunker_are_rechunked_once(tenant) -> None:
    with tenant_context(tenant):
        document = await create_document("Guion", "## Saludo\n\n- Hola\n- ¿Cómo estás?\n\n## Cierre\n\nNos vemos.", "guion")
        async with session_scope() as session:
            # Lo que dejaba el troceador anterior: sin versión y con las listas
            # aplastadas en una línea.
            await session.execute(update(KnowledgeDocument).where(KnowledgeDocument.id == document["id"]).values(metadata_={}))
            await session.execute(update(KnowledgeChunk).where(KnowledgeChunk.document_id == document["id"]).values(content="viejo"))

        assert await rechunk_outdated_documents() == 1
        assert await rechunk_outdated_documents() == 0

        async with session_scope() as session:
            stored = await session.get(KnowledgeDocument, document["id"])
            chunks = (await session.execute(
                select(KnowledgeChunk.content).where(KnowledgeChunk.document_id == document["id"]).order_by(KnowledgeChunk.ordinal)
            )).scalars().all()
    assert stored.metadata_["chunker"] == CHUNKER_VERSION
    assert chunks == ["[Saludo]\n\n- Hola\n- ¿Cómo estás?", "[Cierre]\n\nNos vemos."]


async def test_the_service_of_interest_is_searched_without_its_zone(tenant) -> None:
    with tenant_context(tenant):
        await create_document("Ficha: HIFU 12D - Rostro", "El HIFU 12D tensa el rostro y el cuello con ultrasonido focalizado.", "ficha")
        # El nombre del ERP, tal cual, es "hifu & 12d & !rostro" para Postgres:
        # la ficha habla del rostro y no aparecía.
        assert await search_knowledge_chunks("HIFU 12D - Rostro", 5) == []
        found = await search_knowledge_chunks(service_query("HIFU 12D - Rostro"), 5)
    assert [chunk["title"] for chunk in found] == ["Ficha: HIFU 12D - Rostro"]
