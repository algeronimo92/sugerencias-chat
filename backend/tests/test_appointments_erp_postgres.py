"""Lo que el envío de citas al ERP lee y guarda en PostgreSQL real: los
paquetes vendibles de un servicio, el correo del responsable y el resultado
del envío en la cita."""

from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal

from sqlalchemy import update

from app.db.models.auth import User
from app.db.models.catalogs import LeadService, ServicePackage
from app.db.uow import session_scope
from app.modules.appointments.domain.appointment import AppointmentRequest
from app.modules.appointments.infrastructure.integrations import TeamDirectory
from app.modules.appointments.infrastructure.repository import SqlAppointmentRepository
from app.modules.auth.ports.users import emails_by_ids
from app.modules.catalogs.erp_catalog import apply_catalog, parse_catalog
from app.modules.catalogs.ports.service_packages import sellable_packages
from app.modules.catalogs.service import create_lead_service, create_service_package
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401


async def _user(email: str, name: str, role: str = "vendedor", active: bool = True) -> int:
    async with session_scope() as session:
        user = User(
            email=email, name=name, password_hash="!", role=role, is_active=active,
            created_at=datetime.now(timezone.utc),
        )
        session.add(user)
        await session.flush()
        return user.id


async def test_sellable_packages_are_the_active_ones_of_that_service(tenant) -> None:
    with tenant_context(tenant):
        admin_id = await _user("admin-citas@example.test", "Admin", role="admin")
        await apply_catalog(parse_catalog({"data": [
            {"id": "svc-1", "name": "HIFU 12D - Rostro", "packages": [
                {"id": "pk-3", "label": "x3", "sessions": 3, "price": "400"},
                {"id": "pk-1", "label": "Individual", "sessions": 1, "price": "150"},
                {"id": "pk-6", "label": "x6", "sessions": 6, "price": "700"},
            ]},
            {"id": "svc-2", "name": "Borrado de Cejas", "packages": [
                {"id": "pk-b", "label": "Individual", "sessions": 1, "price": "300"},
            ]},
        ]}))
        # Un paquete que el negocio cargó a mano y otro que el ERP dio de baja.
        manual = await create_lead_service("Evaluación", admin_id)
        await create_service_package(manual["id"], {
            "name": "Gratis", "sessions": 1, "price": Decimal("0"), "notes": None, "position": None,
        })
        async with session_scope() as session:
            await session.execute(update(ServicePackage).where(ServicePackage.external_id == "pk-6").values(is_active=False))

        packages = await sellable_packages("  hifu 12d - rostro ")
        assert sorted((p["name"], p["sessions"], p["external_id"]) for p in packages) == [
            ("Individual", 1, "pk-1"), ("x3", 3, "pk-3"),
        ]
        assert set(packages[0]) == {"id", "name", "sessions", "position", "external_id"}
        # El paquete manual se ofrece, pero sin id del ERP: no se puede enviar.
        assert [(p["name"], p["external_id"]) for p in await sellable_packages("Evaluación")] == [("Gratis", None)]
        assert await sellable_packages("No existe") == []

        async with session_scope() as session:
            await session.execute(update(LeadService).where(LeadService.external_id == "svc-2").values(is_active=False))
        assert await sellable_packages("Borrado de Cejas") == []


async def test_the_seller_email_falls_back_to_who_registered_it(tenant) -> None:
    with tenant_context(tenant):
        grecia = await _user("grecia@example.test", "Grecia")
        former = await _user("ex@example.test", "Antonella", active=False)

        assert await emails_by_ids([grecia, former, None]) == {grecia: "grecia@example.test", former: "ex@example.test"}
        assert await emails_by_ids([]) == {}

        staff = TeamDirectory()
        assert await staff.email_for(" grecia ", former) == "grecia@example.test"
        # La responsable ya no está en el equipo: va quien registró la cita.
        assert await staff.email_for("Antonella", grecia) == "grecia@example.test"
        assert await staff.email_for("Nadie", None) is None


async def test_the_appointment_keeps_what_was_sent_and_how_it_went(tenant) -> None:
    with tenant_context(tenant):
        user_id = await _user("vende@example.test", "Grecia")
        repository = SqlAppointmentRepository()
        request = AppointmentRequest(
            nombre_completo="Rosa Quispe", telefono="987654321", tratamiento="HIFU 12D - Rostro",
            fecha="2026-11-20", hora="15:30", vendedor="Grecia", dni="45678912", adelanto=50,
            payment_method="yape", erp_package_id="pk-1", package_name="Individual",
            comprobante_url="/media/abc.png",
        )

        saved = await repository.add(request.record(created_by_user_id=user_id, lead_id=None, erp_active=True))

        assert (saved["erp_sync_status"], saved["payment_method"], saved["erp_package_id"], saved["package_name"]) == (
            "pending", "yape", "pk-1", "Individual",
        )
        assert saved["comprobante_url"] == "/media/abc.png"

        failed = await repository.record_integrations(
            saved["id"], erp_sync_status="error", erp_sync_error="El ERP no respondió a tiempo",
        )
        assert (failed["erp_sync_status"], failed["erp_sync_error"]) == ("error", "El ERP no respondió a tiempo")

        synced = await repository.record_integrations(
            saved["id"], erp_appointment_id="erp-1", erp_link="https://erp.example/appointments/erp-1",
            erp_sync_status="synced", erp_sync_error=None, clear_erp_sync_error=True,
        )
        assert (synced["erp_sync_status"], synced["erp_appointment_id"], synced["erp_sync_error"]) == (
            "synced", "erp-1", None,
        )
        assert synced["erp_link"] == "https://erp.example/appointments/erp-1"

        # Sin envío al ERP la cita no queda "pendiente" de nada.
        plain = await repository.add(AppointmentRequest(
            nombre_completo="Ana", telefono="987654322", tratamiento="Consulta",
            fecha="2026-11-21", hora="10:00", vendedor="Grecia",
        ).record(created_by_user_id=user_id, lead_id=None))
        assert plain["erp_sync_status"] == "not_configured"
