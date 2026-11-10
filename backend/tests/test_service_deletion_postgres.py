"""Borrar un servicio del catálogo contra PostgreSQL real: se borra el manual
que nadie usa (con sus paquetes) y se rechaza, diciendo qué lo usa, el que ya
tiene leads, plantillas, reglas que lo asignan o documentos de la IA.
Una regla que solo filtra por su nombre no lo impide: se avisa qué le pasa."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
from uuid import uuid4

import pytest
from sqlalchemy import func, insert, select, update

from app.db.models.auth import User
from app.db.models.automations import AutomationRule
from app.db.models.catalogs import LeadService, MessageTemplate, ServicePackage
from app.db.models.leads import Lead
from app.db.uow import session_scope
from app.modules.ai.knowledge_service import create_document
from app.modules.catalogs.erp_catalog import apply_catalog, parse_catalog
from app.modules.catalogs.errors import ErpManagedError, ServiceInUseError
from app.modules.catalogs.queries import list_lead_services
from app.modules.catalogs.service import create_lead_service, create_service_package, delete_lead_service, service_usage
from app.modules.leads.infrastructure.repository import ensure_lead_stub
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401

NOW = datetime.now(timezone.utc)


async def _admin() -> int:
    async with session_scope() as session:
        user = User(
            email=f"admin-{uuid4().hex[:6]}@example.test", name="Admin", password_hash="!",
            role="admin", is_active=True, created_at=NOW,
        )
        session.add(user)
        await session.flush()
        return user.id


async def _lead_interested_in(name: str) -> str:
    chat_id = str(uuid4())
    await ensure_lead_stub(chat_id, NOW, "test")
    async with session_scope() as session:
        # Como lo deja un vendedor: con otras mayúsculas y un espacio de más.
        await session.execute(update(Lead).where(Lead.id == chat_id).values(servicio_interes=f" {name.upper()} "))
    return chat_id


async def _usages(service_id: int) -> list[str]:
    with pytest.raises(ServiceInUseError) as error:
        await delete_lead_service(service_id)
    return [usage.label for usage in error.value.usages]


async def test_unused_manual_service_is_deleted_with_its_packages(tenant) -> None:
    with tenant_context(tenant):
        admin_id = await _admin()
        service = await create_lead_service("Evaluacion por error", admin_id)
        await create_service_package(service["id"], {"name": "Única", "sessions": 1, "price": Decimal("50"), "notes": None, "position": None})

        assert await delete_lead_service(service["id"]) is True

        assert service["id"] not in {item["id"] for item in await list_lead_services(include_inactive=True)}
        async with session_scope() as session:
            packages = await session.scalar(select(func.count()).select_from(ServicePackage).where(ServicePackage.service_id == service["id"]))
        assert packages == 0
        assert await delete_lead_service(service["id"]) is False


async def test_service_in_use_is_kept_and_reports_every_use(tenant) -> None:
    with tenant_context(tenant):
        admin_id = await _admin()
        service = await create_lead_service("Peeling químico", admin_id)
        name, service_id = service["name"], service["id"]

        lead_id = await _lead_interested_in(name)
        await _lead_interested_in(name)
        async with session_scope() as session:
            await session.execute(insert(MessageTemplate).values(name="Info peeling", content="Hola", service=name, created_by_user_id=admin_id, created_at=NOW, updated_at=NOW))
            await session.execute(insert(AutomationRule).values(
                name="Asignar peeling", trigger_type="manual", trigger_config={}, conditions={},
                actions=[{"type": "change_service", "service": name.upper()}], delay_minutes=0,
                created_by_user_id=admin_id, created_at=NOW, updated_at=NOW,
            ))
            # Solo filtra por el nombre: se avisa, no impide borrarlo.
            await session.execute(insert(AutomationRule).values(
                name="Seguimiento peeling", trigger_type="manual", trigger_config={},
                conditions={"service_contains": name.lower()}, actions=[], delay_minutes=0,
                created_by_user_id=admin_id, created_at=NOW, updated_at=NOW,
            ))
            # Una regla borrada no cuenta.
            await session.execute(insert(AutomationRule).values(
                name="Vieja", trigger_type="manual", trigger_config={}, conditions={},
                actions=[{"type": "change_service", "service": name}], delay_minutes=0,
                created_by_user_id=admin_id, created_at=NOW, updated_at=NOW, deleted_at=NOW,
            ))
        await create_document("Ficha del peeling", "Renueva la piel.", "ficha", service_ids=[service_id])

        assert sorted(await _usages(service_id)) == sorted([
            "1 plantilla", "2 leads", "1 automatización", "1 documento de conocimiento",
        ])

        # Lo mismo, con a quién ir a ver: el cuadro de eliminar lo muestra
        # antes de intentarlo (antes solo decía "1 lead", sin cuál).
        report = await service_usage(service_id)
        by_kind = {usage.kind: usage for usage in report.usages}
        assert set(by_kind) == {"plantillas", "leads", "automatizaciones", "documentos"}
        assert len(by_kind["leads"].items) == 2 and lead_id in {item_id for item_id, _ in by_kind["leads"].items}
        assert by_kind["leads"].count == 2
        assert [name for _, name in by_kind["plantillas"].items] == ["Info peeling"]
        assert [name for _, name in by_kind["automatizaciones"].items] == ["Asignar peeling"]
        assert [(notice.kind, [rule for _, rule in notice.items]) for notice in report.notices] == [("filtros", ["Seguimiento peeling"])]
        assert "dejarán de aplicarse" in report.notices[0].detail
        assert [name for _, name in by_kind["documentos"].items] == ["Ficha del peeling"]

        async with session_scope() as session:
            assert await session.scalar(select(LeadService.id).where(LeadService.id == service_id)) == service_id


async def test_erp_service_cannot_be_deleted_in_the_crm(tenant) -> None:
    with tenant_context(tenant):
        await apply_catalog(parse_catalog({"data": [{"id": "svc-9", "name": "HIFU", "description": None, "icon": None, "packages": []}]}))
        service = next(item for item in await list_lead_services(include_inactive=True) if item["name"] == "HIFU")

        with pytest.raises(ErpManagedError):
            await delete_lead_service(service["id"])

        assert await service_usage(999_999) is None


async def test_leads_can_be_cleared_in_bulk_and_then_the_service_deleted(tenant) -> None:
    from app.modules.leads.application.commands import reassign_service_interest
    from app.modules.leads.domain.lead import Actor

    with tenant_context(tenant):
        admin_id = await _admin()
        service = await create_lead_service("Borrado de Tatuajes", admin_id)
        destination = await create_lead_service("Borrado de Tatuajes - XL", admin_id)
        first, second = await _lead_interested_in(service["name"]), await _lead_interested_in(service["name"])

        assert {usage.kind for usage in (await service_usage(service["id"])).usages} == {"leads"}

        # A otro servicio activo: el nombre queda como está en el catálogo.
        assert await reassign_service_interest("borrado de tatuajes", "BORRADO DE TATUAJES - XL", actor=Actor.user(admin_id)) == 2
        async with session_scope() as session:
            values = (await session.execute(select(Lead.servicio_interes).where(Lead.id.in_([first, second])))).scalars().all()
        assert values == [destination["name"], destination["name"]]

        # Y de ahí, sin servicio.
        assert await reassign_service_interest(destination["name"], None, actor=Actor.user(admin_id)) == 2
        assert (await service_usage(service["id"])).usages == []
        assert await delete_lead_service(service["id"]) is True


async def test_a_rule_that_only_filters_by_the_name_does_not_block_deletion(tenant) -> None:
    with tenant_context(tenant):
        admin_id = await _admin()
        service = await create_lead_service("Hollywood Peel", admin_id)
        for zone in ("Axilas", "Cuello", "Rostro", "Rostro + Cuello"):
            await create_lead_service(f"Hollywood Peel - {zone}", admin_id)
        async with session_scope() as session:
            await session.execute(insert(AutomationRule).values(
                name="Anuncio peel", trigger_type="manual", trigger_config={},
                conditions={"service_contains": "hollywood peel"}, actions=[], delay_minutes=0,
                created_by_user_id=admin_id, created_at=NOW, updated_at=NOW,
            ))

        report = await service_usage(service["id"])
        assert report.usages == []
        # El filtro es texto: sigue atrapando al otro servicio que lo contiene.
        assert "«Hollywood Peel - Axilas», «Hollywood Peel - Cuello», «Hollywood Peel - Rostro» y otros" in report.notices[0].detail

        assert await delete_lead_service(service["id"]) is True
        async with session_scope() as session:
            conditions = await session.scalar(select(AutomationRule.conditions).where(AutomationRule.name == "Anuncio peel"))
        assert conditions == {"service_contains": "hollywood peel"}
