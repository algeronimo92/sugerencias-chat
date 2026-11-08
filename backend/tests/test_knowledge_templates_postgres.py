"""Plantillas de la plataforma contra PostgreSQL real: el negocio importa una
copia propia, la edita, y la plantilla puede cambiar sin tocar la copia."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

import pytest
from sqlalchemy import delete

from app.db.models.auth import User
from app.db.models.control import KnowledgeTemplate
from app.db.session import control_session
from app.db.uow import session_scope
from app.modules.ai.knowledge_service import (
    TemplateNotFound,
    get_document,
    import_template,
    list_documents,
    list_importable_templates,
    update_document,
)
from app.modules.catalogs.service import create_lead_service
from app.modules.platform.knowledge_templates import create_template, list_templates, update_template
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401

FICHA = (
    "Hollywood Peel\n\n"
    "Qué es: peeling con carbón activado y láser.\n\n"
    "Sesiones: suelen recomendarse 3, cada 15 días."
)


@pytest.fixture
async def cleanup_templates():
    """``public`` no se descarta con el schema del tenant: sin esto cada corrida
    deja sus plantillas en la base local y aparecen en el panel de desarrollo."""

    created: list[int] = []
    yield created
    async with control_session() as session:
        await session.execute(delete(KnowledgeTemplate).where(KnowledgeTemplate.id.in_(created)))


async def test_import_is_a_business_copy_independent_of_the_template(tenant, cleanup_templates) -> None:
    template = await create_template({
        "title": "  Ficha   Hollywood Peel ", "document_type": "ficha", "service_hint": "Hollywood Peel",
        "content": FICHA, "is_active": True,
    })
    hidden = await create_template({"title": "Borrador", "document_type": None, "service_hint": None, "content": "x", "is_active": False})
    cleanup_templates.extend([template["id"], hidden["id"]])
    assert template["title"] == "Ficha Hollywood Peel" and template["version"] == 1
    assert hidden["id"] in [item["id"] for item in await list_templates(include_inactive=True)]

    with tenant_context(tenant):
        async with session_scope() as session:
            user = User(email=f"a-{uuid4().hex[:6]}@example.test", name="A", password_hash="!", role="admin", is_active=True, created_at=datetime.now(timezone.utc))
            session.add(user)
            await session.flush()
            admin_id = user.id
        peel = await create_lead_service("Hollywood Peel - Rostro", admin_id)

        offered = {item["id"]: item for item in await list_importable_templates()}
        assert template["id"] in offered and hidden["id"] not in offered
        assert offered[template["id"]]["imported"] is False

        copy = await import_template(template["id"], service_id=peel["id"])
        assert (copy["title"], copy["document_type"], copy["service_id"], copy["template_id"]) == (
            "Ficha Hollywood Peel", "ficha", peel["id"], template["id"],
        )
        assert copy["chunk_count"] >= 1
        assert {item["id"]: item for item in await list_importable_templates()}[template["id"]]["imported"] is True

        # El negocio la edita a su gusto.
        edited = await update_document(
            copy["id"], "Ficha Hollywood Peel (DermicaPro)", FICHA + "\n\nEn DermicaPro: evaluación gratuita.",
            document_type="ficha", service_id=peel["id"],
        )
        assert edited["template_id"] == template["id"]

        # Importar otra vez da una segunda copia, no pisa la editada.
        second = await import_template(template["id"], service_id=None)
        assert second["id"] != copy["id"] and second["service_id"] is None
        assert len([d for d in await list_documents() if d["template_id"] == template["id"]]) == 2

        with pytest.raises(TemplateNotFound):
            await import_template(hidden["id"], service_id=None)

    # La plataforma edita la plantilla: sube la versión y la copia del negocio no cambia.
    updated = await update_template(template["id"], {"content": FICHA + "\n\nNuevo párrafo de la plataforma."})
    assert updated["version"] == 2
    unchanged = await update_template(template["id"], {"is_active": True})
    assert unchanged["version"] == 2

    with tenant_context(tenant):
        kept = await get_document(copy["id"])
        assert "evaluación gratuita" in kept["content"] and "Nuevo párrafo" not in kept["content"]
