"""Conocimiento por servicio contra PostgreSQL real: vínculo (a uno o a varios
servicios), búsqueda filtrada, fichas primero y que borrar el servicio no
borre el documento."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import delete

from app.db.models.auth import User
from app.db.models.catalogs import LeadService
from app.db.uow import session_scope
from app.modules.ai.knowledge_search import search_knowledge_chunks, service_knowledge_chunks
from app.modules.ai.knowledge_service import create_document, get_document, list_documents, update_document
from app.modules.catalogs.service import create_lead_service
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401


async def test_documents_belong_to_a_service_and_search_prioritises_it(tenant) -> None:
    with tenant_context(tenant):
        async with session_scope() as session:
            user = User(email=f"a-{uuid4().hex[:6]}@example.test", name="A", password_hash="!", role="admin", is_active=True, created_at=datetime.now(timezone.utc))
            session.add(user)
            await session.flush()
            admin_id = user.id
        peel = await create_lead_service("Hollywood Peel - Rostro", admin_id)
        botox = await create_lead_service("Botox", admin_id)

        faq = await create_document("Preguntas del peel", "¿Duele? No, se siente calor leve.", "faq", service_ids=[peel["id"]])
        ficha = await create_document("Hollywood Peel", "Usa carbón activado. Se recomiendan tres sesiones.", "ficha", service_ids=[peel["id"]])
        await create_document("Ficha Botox", "Toxina para líneas de expresión. Dura cuatro meses; tres sesiones al año.", "ficha", service_ids=[botox["id"]])
        await create_document("Política de pagos", "Aceptamos Yape y tarjeta.", "politica")

        listed = {item["title"]: item for item in await list_documents()}
        assert listed["Hollywood Peel"]["service_ids"] == [peel["id"]]
        assert listed["Política de pagos"]["service_ids"] == []
        assert listed["Hollywood Peel"]["document_type"] == "ficha"

        # Filtrada por servicio: "sesiones" está en dos fichas, solo vuelve la del peel.
        found = await search_knowledge_chunks("sesiones", 5, peel["id"])
        assert [chunk["title"] for chunk in found] == ["Hollywood Peel"]
        assert len(await search_knowledge_chunks("sesiones", 5)) == 2

        # El título encuentra el documento aunque el párrafo no lo repita.
        assert [chunk["title"] for chunk in await search_knowledge_chunks("Hollywood", 5)][0] == "Hollywood Peel"

        # Sin consulta: fichas antes que las FAQ.
        assert [chunk["title"] for chunk in await service_knowledge_chunks(peel["id"], 5)] == ["Hollywood Peel", "Preguntas del peel"]

        # Editar puede mover el documento a otro servicio o volverlo general.
        moved = await update_document(faq["id"], "Preguntas del peel", "¿Duele? No.", document_type="faq", service_ids=[])
        assert moved["service_ids"] == []

        with pytest.raises(ValueError):
            await create_document("Huérfano", "texto", service_ids=[999_999])

        # Una ficha para varios servicios ("Botox - 1 Zona" y "2 Zonas"): se
        # encuentra filtrando por cualquiera, sale una sola vez en la lista y
        # los repetidos no se guardan dos veces.
        shared = await update_document(
            ficha["id"], "Hollywood Peel", "Usa carbón activado. Se recomiendan tres sesiones.",
            document_type="ficha", service_ids=[botox["id"], peel["id"], botox["id"]],
        )
        assert shared["service_ids"] == sorted([peel["id"], botox["id"]])
        assert [chunk["title"] for chunk in await search_knowledge_chunks("carbón", 5, botox["id"])] == ["Hollywood Peel"]
        assert [chunk["title"] for chunk in await search_knowledge_chunks("carbón", 5, peel["id"])] == ["Hollywood Peel"]
        assert (await search_knowledge_chunks("carbón", 5, botox["id"]))[0]["service_ids"] == sorted([peel["id"], botox["id"]])
        assert [item["title"] for item in await list_documents()].count("Hollywood Peel") == 1

        # Borrar un servicio quita solo ese vínculo: la ficha sigue siendo del otro.
        async with session_scope() as session:
            await session.execute(delete(LeadService).where(LeadService.id == peel["id"]))
        assert (await get_document(ficha["id"]))["service_ids"] == [botox["id"]]
        # Sin servicios queda como conocimiento general.
        async with session_scope() as session:
            await session.execute(delete(LeadService).where(LeadService.id == botox["id"]))
        assert (await get_document(ficha["id"]))["service_ids"] == []
