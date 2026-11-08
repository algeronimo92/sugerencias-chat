"""El sincronizador contra PostgreSQL real: adopta lo cargado a mano, crea,
renombra siguiendo al servicio, desactiva sin borrar y no toca lo manual."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from uuid import uuid4

from sqlalchemy import select, update

from app.db.models.catalogs import LeadService, ServicePackage
from app.db.uow import session_scope
from app.modules.catalogs.erp_catalog import SyncSummary, apply_catalog, parse_catalog, sync_catalog, sync_status
from app.modules.catalogs.queries import list_lead_services
from app.modules.catalogs.service import create_lead_service, create_service_package, update_lead_service
from app.modules.catalogs.errors import ErpManagedError
from app.modules.leads.infrastructure.repository import ensure_lead_stub
from app.modules.platform.ports.settings_service import update_settings
from app.db.models.auth import User
from app.db.models.leads import Lead
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401


def _erp(*services):
    return parse_catalog({"data": list(services)})


def _svc(id_, name, *packages):
    return {"id": id_, "name": name, "description": None, "icon": None, "packages": [
        {"id": pid, "label": label, "sessions": sessions, "price": price} for pid, label, sessions, price in packages
    ]}


async def _admin() -> int:
    async with session_scope() as session:
        user = User(
            email="admin-erp@example.test", name="Admin", password_hash="!",
            role="admin", is_active=True, created_at=datetime.now(timezone.utc),
        )
        session.add(user)
        await session.flush()
        return user.id


async def _services() -> dict[str, dict]:
    return {service["name"]: service for service in await list_lead_services(include_inactive=True)}


async def test_sync_adopts_manual_services_creates_renames_and_deactivates(tenant) -> None:
    with tenant_context(tenant):
        admin_id = await _admin()
        # El negocio ya había cargado el servicio a mano, con su precio suelto
        # y una descripción para la IA que el ERP no trae.
        manual = await create_lead_service("Hollywood Peel - Rostro", admin_id)
        await update_lead_service(manual["id"], {"description": "Peeling con carbón activado"}, admin_id)
        await create_service_package(manual["id"], {"name": "Individual", "sessions": 1, "price": Decimal("150"), "notes": None, "position": None})
        # Y otro que el ERP no conoce: no debe tocarse.
        await create_lead_service("Asesoría online", admin_id)

        summary = await apply_catalog(_erp(
            _svc("svc-1", "Hollywood Peel - Rostro", ("svc-1", "Individual", 1, "180"), ("pk-3", "x3", 3, "400")),
            _svc("svc-2", "Borrado de Cejas", ("svc-2", "Individual", 1, "300")),
        ))

        assert summary == SyncSummary(
            services_total=2, services_created=1, services_updated=1,
            packages_created=2, packages_updated=1,
        )
        services = await _services()
        peel = services["Hollywood Peel - Rostro"]
        assert peel["external_id"] == "svc-1"
        assert peel["description"] == "Peeling con carbón activado"
        assert [(p["name"], p["sessions"], str(p["price"]), p["external_id"], p["is_active"]) for p in peel["packages"]] == [
            ("Individual", 1, "180.00", "svc-1", True),
            ("x3", 3, "400.00", "pk-3", True),
        ]
        assert services["Borrado de Cejas"]["external_id"] == "svc-2"
        assert services["Asesoría online"]["external_id"] is None
        assert services["Asesoría online"]["is_active"] is True

        # Un lead interesado en el servicio sigue al renombre del ERP.
        lead_id = str(uuid4())
        await ensure_lead_stub(lead_id, None, None)
        async with session_scope() as session:
            await session.execute(update(Lead).where(Lead.id == lead_id).values(servicio_interes="Hollywood Peel - Rostro"))

        summary = await apply_catalog(_erp(
            _svc("svc-1", "Hollywood Peel Rostro", ("svc-1", "Individual", 1, "180")),
        ))

        assert summary.services_updated == 1
        assert summary.services_deactivated == 1  # Borrado de Cejas salió del ERP
        assert summary.packages_deactivated == 1  # el x3 salió del ERP
        services = await _services()
        assert "Hollywood Peel - Rostro" not in services
        peel = services["Hollywood Peel Rostro"]
        assert [(p["name"], p["is_active"]) for p in peel["packages"]] == [("Individual", True), ("x3", False)]
        assert services["Borrado de Cejas"]["is_active"] is False
        assert all(not p["is_active"] for p in services["Borrado de Cejas"]["packages"])
        assert services["Asesoría online"]["is_active"] is True
        async with session_scope() as session:
            assert await session.scalar(select(Lead.servicio_interes).where(Lead.id == lead_id)) == "Hollywood Peel Rostro"

        # Vuelve al ERP: se reactiva en vez de duplicarse.
        summary = await apply_catalog(_erp(
            _svc("svc-1", "Hollywood Peel Rostro", ("svc-1", "Individual", 1, "180")),
            _svc("svc-2", "Borrado de Cejas", ("svc-2", "Individual", 1, "320")),
        ))
        assert summary.services_created == 0
        services = await _services()
        assert services["Borrado de Cejas"]["is_active"] is True
        assert str(services["Borrado de Cejas"]["packages"][0]["price"]) == "320.00"
        async with session_scope() as session:
            assert await session.scalar(select(LeadService.id).where(LeadService.external_id == "svc-2")) == services["Borrado de Cejas"]["id"]

        # Idempotente: sin cambios, no escribe nada.
        again = await apply_catalog(_erp(
            _svc("svc-1", "Hollywood Peel Rostro", ("svc-1", "Individual", 1, "180")),
            _svc("svc-2", "Borrado de Cejas", ("svc-2", "Individual", 1, "320")),
        ))
        assert again == SyncSummary(services_total=2)


async def test_sync_reports_name_conflicts_and_keeps_going(tenant) -> None:
    with tenant_context(tenant):
        admin_id = await _admin()
        await create_lead_service("Botox", admin_id)  # manual, sin external_id
        await apply_catalog(_erp(_svc("svc-9", "Toxina", ("svc-9", "Individual", 1, "500"))))

        # El ERP renombra svc-9 como "Botox", que ya existe a mano: conflicto
        # en ese servicio, el resto de la pasada se aplica.
        summary = await apply_catalog(_erp(
            _svc("svc-9", "Botox", ("svc-9", "Individual", 1, "500")),
            _svc("svc-10", "Rinomodelación", ("svc-10", "Individual", 1, "900")),
        ))

        assert summary.conflicts == ["Botox"]
        assert summary.services_created == 1
        services = await _services()
        assert services["Toxina"]["is_active"] is True
        assert services["Rinomodelación"]["external_id"] == "svc-10"


async def test_erp_managed_service_is_read_only_in_the_crm(tenant) -> None:
    with tenant_context(tenant):
        admin_id = await _admin()
        await apply_catalog(_erp(_svc("svc-1", "Hollywood Peel", ("svc-1", "Individual", 1, "180"))))
        service = (await _services())["Hollywood Peel"]

        # La descripción sí es del CRM.
        updated = await update_lead_service(service["id"], {"description": "Para manchas"}, admin_id)
        assert updated["description"] == "Para manchas"

        for values in ({"name": "Otro"}, {"is_active": False}):
            try:
                await update_lead_service(service["id"], values, admin_id)
            except ErpManagedError:
                pass
            else:
                raise AssertionError(f"debió rechazar {values}")
        try:
            await create_service_package(service["id"], {"name": "x5", "sessions": 5, "price": Decimal("700"), "notes": None, "position": None})
        except ErpManagedError:
            pass
        else:
            raise AssertionError("debió rechazar el paquete manual")


async def test_sync_catalog_end_to_end_records_status(tenant) -> None:
    with tenant_context(tenant):
        status = await sync_status()
        assert status == {"configured": False, "url": None, "synced_at": None, "last_error": None, "last_summary": None}

        await update_settings({"erp_catalog_url": "https://erp.example.test/api/public/catalog"})

        async def fetch(url):
            assert url == "https://erp.example.test/api/public/catalog"
            return {"data": [_svc("svc-1", "Hollywood Peel", ("svc-1", "Individual", 1, "180"))]}

        status = await sync_catalog(fetch)
        assert status["configured"] is True
        assert status["synced_at"]
        assert status["last_error"] is None
        assert status["last_summary"]["services_created"] == 1

        async def broken(_url):
            return {"data": "no"}

        try:
            await sync_catalog(broken)
        except Exception:
            pass
        status = await sync_status()
        assert "formato esperado" in status["last_error"]
        # La última pasada buena sigue informada.
        assert status["last_summary"]["services_created"] == 1
        async with session_scope() as session:
            assert await session.scalar(select(ServicePackage.price).where(ServicePackage.external_id == "svc-1")) == Decimal("180.00")
