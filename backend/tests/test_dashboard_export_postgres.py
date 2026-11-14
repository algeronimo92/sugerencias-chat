"""Reportes del dashboard en Excel contra PostgreSQL: las consultas reales,
el archivo que sale y el registro de quién lo bajó."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import select, update

from app.db.models.appointments import Appointment
from app.db.models.auth import User
from app.db.models.catalogs import LeadService, LeadTag, ServicePackage
from app.db.models.leads import DataExport, Lead, LeadTagAssignment
from app.db.models.tasks import LeadTask
from app.db.uow import session_scope
from app.modules.leads.dashboard.export import ExportReport, build_export
from app.modules.leads.infrastructure.repository import ensure_lead_stub
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401
from tests.xlsx_reader import read_sheet, sheet_names


NOW = datetime.now(timezone.utc)


async def _user(name: str, role: str = "vendedor", active: bool = True) -> int:
    async with session_scope() as session:
        user = User(
            email=f"{uuid4().hex[:8]}@example.test", name=name, password_hash="!",
            role=role, is_active=active, created_at=NOW,
        )
        session.add(user)
        await session.flush()
        return user.id


async def _lead(name: str, seller_id: int | None, *, phone: str, days_ago: int = 0, custom=None) -> str:
    lead_id = str(uuid4())
    await ensure_lead_stub(lead_id, None, None)
    async with session_scope() as session:
        await session.execute(
            update(Lead).where(Lead.id == lead_id).values(
                nombre=name, telefono=phone, vendedor_id=seller_id, origen="Anuncio Hifu",
                created_at=NOW - timedelta(days=days_ago), custom_fields=custom or {},
            )
        )
    return lead_id


async def _appointment(user_id: int, lead_id: str | None, *, name: str, adelanto: str, status: str = "created",
                       test: bool = False) -> None:
    async with session_scope() as session:
        session.add(Appointment(
            created_by_user_id=user_id, lead_id=lead_id, nombre_completo=name, dni="44556677", telefono="+51911",
            tratamiento="Hifu 12D", fecha=date(2026, 12, 1), hora="10:00", vendedor="x", status=status,
            test_mode=test, adelanto=Decimal(adelanto), custom_fields={}, created_at=NOW,
        ))


async def _exports() -> list[tuple]:
    async with session_scope() as session:
        rows = (await session.execute(
            select(DataExport.user_id, DataExport.report, DataExport.period_days, DataExport.row_count).order_by(DataExport.id)
        )).all()
    return [tuple(row) for row in rows]


async def test_every_report_reads_the_real_tables_and_leaves_a_record(tenant) -> None:
    with tenant_context(tenant):
        admin = await _user("Dueña", role="admin")
        grecia = await _user("Grecia")
        await _user("Se fue", active=False)
        ana = await _lead("=Ana", grecia, phone="+51999000111", custom={"distrito": "Surco"})
        luis = await _lead("Luis", None, phone="+51999000222")
        await _lead("Vieja", grecia, phone="+51999000333", days_ago=60)

        await _appointment(grecia, ana, name="=Ana", adelanto="100")
        await _appointment(admin, luis, name="Luis", adelanto="50.5")
        await _appointment(grecia, ana, name="=Ana", adelanto="999", status="duplicate")
        await _appointment(grecia, ana, name="Prueba", adelanto="1", test=True)

        async with session_scope() as session:
            tag = LeadTag(name="VIP", color="#000", is_active=True, created_by=admin, created_at=NOW)
            service = LeadService(name="Hifu", is_active=True, created_by=admin, created_at=NOW)
            session.add_all([tag, service])
            await session.flush()
            session.add(LeadTagAssignment(lead_id=ana, tag_id=tag.id, assigned_by=admin, assigned_at=NOW))
            session.add(ServicePackage(service_id=service.id, name="3 sesiones", sessions=3, price=Decimal("900"),
                                       position=0, is_active=True, created_at=NOW))
            session.add(LeadTask(lead_id=ana, title="Llamar", task_type="llamada", status="pending", priority="high",
                                 due_at=NOW, assigned_user_id=grecia, created_by_user_id=admin,
                                 created_at=NOW, updated_at=NOW))

        separations = await build_export(ExportReport.SEPARATIONS, 30, admin, personal_data=True)
        rows = read_sheet(separations.content)
        # Las mismas separaciones que el panel: sin la duplicada ni la de prueba.
        assert [row[3] for row in rows[1:]] == ["=Ana", "Luis"]
        assert rows[1][4:8] == ["44556677", "+51911", "Hifu 12D", 100.0]
        assert rows[1][10:12] == ["Grecia", "Grecia"]
        assert rows[2][10:12] == ["Dueña", "Lead sin vendedora"]

        sellers = await build_export(ExportReport.SELLERS, 30, admin, personal_data=False)
        by_name = {row[0]: row for row in read_sheet(sellers.content)[1:]}
        assert set(by_name) == {"Dueña", "Grecia", "Sin asignar"}
        assert by_name["Grecia"][2:] == [1.0, 0.0, 0.0, 1.0, 100.0, 1.0, 100.0]
        assert by_name["Sin asignar"][2] == 1.0 and by_name["Sin asignar"][7:] == [1.0, 50.5]

        leads = await build_export(ExportReport.LEADS, 30, admin, personal_data=True)
        lead_rows = read_sheet(leads.content)
        assert sorted(row[0] for row in lead_rows[1:]) == ["=Ana", "Luis"]
        ana_row = next(row for row in lead_rows[1:] if row[0] == "=Ana")
        assert ana_row[1] == "+51999000111" and ana_row[5] == "Grecia" and ana_row[6] == "VIP"

        backup = await build_export(ExportReport.BACKUP, 30, admin, personal_data=True)
        assert sheet_names(backup.content) == ["Leads", "Citas", "Tareas", "Servicios y paquetes"]
        assert len(read_sheet(backup.content, 1)) == 4  # encabezado + tres leads, también el viejo
        assert len(read_sheet(backup.content, 2)) == 4  # sin la de prueba, con la duplicada
        assert read_sheet(backup.content, 3)[1][2] == "Llamar"
        assert read_sheet(backup.content, 4)[1][:5] == ["Hifu", "Sí", "3 sesiones", 3.0, 900.0]

        assert await _exports() == [
            (admin, "separaciones", 30, 2),
            (admin, "vendedoras", 30, 3),
            (admin, "leads", 30, 2),
            (admin, "respaldo", None, 3 + 3 + 1 + 1),
        ]
