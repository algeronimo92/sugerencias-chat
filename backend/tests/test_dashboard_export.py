"""Reportes del dashboard en Excel, sin base: permisos, armado y celdas."""

from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.modules.leads.dashboard import api as dashboard_router
from app.modules.leads.dashboard import export
from app.modules.leads.dashboard.export import ExportFile, ExportReport
from app.modules.leads.dashboard.workbook import Column, Sheet, build_workbook
from tests.xlsx_reader import read_sheet, sheet_names


# --- Celdas -----------------------------------------------------------------------

def test_text_from_customers_never_becomes_a_formula_or_a_number():
    """Un contacto de WhatsApp puede llamarse "=HYPERLINK(...)": al abrir el
    archivo en la computadora de la dueña tiene que verse como texto."""
    content = build_workbook([Sheet("Datos", [Column("Nombre"), Column("Teléfono")], [
        ['=HYPERLINK("http://x.test","clic")', "+51999888777"],
        ["@SUMA(A1)", "0051999"],
        ["con\x00control\x1f", None],
    ])])
    rows = read_sheet(content)
    assert rows[1] == ['=HYPERLINK("http://x.test","clic")', "+51999888777"]
    assert rows[2] == ["@SUMA(A1)", "0051999"]
    assert rows[3] == ["concontrol"]


def test_dates_are_written_in_the_business_time_and_amounts_as_numbers():
    content = build_workbook([Sheet("Datos", [Column("Cuándo", "datetime"), Column("Día", "date"), Column("Monto", "money")], [
        # 03:00 UTC del 2 es el 1 a las 22:00 en Lima.
        [datetime(2026, 11, 2, 3, 0, tzinfo=timezone.utc), date(2026, 11, 2), Decimal("95.50")],
    ])])
    row = read_sheet(content)[1]
    # Número de serie de Excel: entero = día, fracción = hora.
    assert row[0] == pytest.approx(46327 + 22 / 24)
    assert row[1] == 46328.0
    assert row[2] == 95.5


# --- Permisos -------------------------------------------------------------------

@pytest.mark.asyncio
async def test_a_seller_exports_nothing_and_an_analyst_only_numbers_without_personal_data(monkeypatch):
    """El riesgo es que una vendedora se vaya con la cartera de pacientes."""
    received = []

    async def fake_build(report, days, user_id, *, personal_data):
        received.append((report, days, user_id, personal_data))
        return ExportFile(filename=f"{report.value}.xlsx", content=b"xlsx", row_count=0)

    monkeypatch.setattr(dashboard_router, "build_export", fake_build)

    seller = SimpleNamespace(id=3, role="vendedor")
    for report in ExportReport:
        with pytest.raises(HTTPException) as exc:
            await dashboard_router.export_report(report=report, days=30, user=seller)
        assert exc.value.status_code == 403

    analyst = SimpleNamespace(id=2, role="analista")
    for report in (ExportReport.LEADS, ExportReport.BACKUP):
        with pytest.raises(HTTPException) as exc:
            await dashboard_router.export_report(report=report, days=30, user=analyst)
        assert exc.value.status_code == 403
    await dashboard_router.export_report(report=ExportReport.SEPARATIONS, days=30, user=analyst)
    await dashboard_router.export_report(report=ExportReport.SELLERS, days=90, user=analyst)

    admin = SimpleNamespace(id=1, role="admin")
    response = await dashboard_router.export_report(report=ExportReport.BACKUP, days=30, user=admin)

    assert received == [
        (ExportReport.SEPARATIONS, 30, 2, False),
        (ExportReport.SELLERS, 90, 2, False),
        (ExportReport.BACKUP, 30, 1, True),
    ]
    assert response.media_type == export.XLSX_MEDIA_TYPE
    assert response.headers["content-disposition"] == 'attachment; filename="respaldo.xlsx"'


# --- Armado -----------------------------------------------------------------------

@pytest.fixture
def recorded(monkeypatch):
    calls = []

    async def fake_record(user_id, report, days, row_count):
        calls.append((user_id, report, days, row_count))

    async def no_currency():
        return "PEN"

    monkeypatch.setattr(export, "_record", fake_record)
    monkeypatch.setattr(export, "business_currency", no_currency)
    return calls


def _separation(**overrides):
    row = {
        "created_at": datetime(2026, 11, 10, 15, tzinfo=timezone.utc), "date": date(2026, 11, 20), "time": "10:00",
        "name": "Ana", "dni": "12345678", "phone": "+51999", "treatment": "Hifu", "amount": 100.0,
        "receipt": "voucher.jpg", "status": "Registrada", "registered_by": "Lucía", "owner": "Grecia", "origin": "Anuncio",
    }
    return {**row, **overrides}


@pytest.mark.asyncio
async def test_an_analyst_gets_the_separations_without_phone_or_dni(monkeypatch, recorded):
    async def rows(scope):
        return [_separation(), _separation(receipt=None, amount=0.0)]

    monkeypatch.setattr(export.appointments_queries, "separation_export_rows", rows)

    for personal_data, expected_headers in (
        (True, ["Fecha de separación", "Fecha de la cita", "Hora", "Paciente", "DNI", "Teléfono", "Tratamiento",
                "Adelanto (PEN)", "Comprobante", "Estado", "Registró", "Vendedora del lead", "Origen del lead"]),
        (False, ["Fecha de separación", "Fecha de la cita", "Hora", "Paciente", "Tratamiento",
                 "Adelanto (PEN)", "Comprobante", "Estado", "Registró", "Vendedora del lead", "Origen del lead"]),
    ):
        exported = await export.build_export(ExportReport.SEPARATIONS, 30, 7, personal_data=personal_data)
        rows_read = read_sheet(exported.content)
        assert rows_read[0] == expected_headers
        assert "12345678" not in str(rows_read) or personal_data
        assert rows_read[2][expected_headers.index("Comprobante")] == "No"
        assert exported.filename.startswith("separaciones-30-dias-") and exported.filename.endswith(".xlsx")

    assert recorded == [(7, ExportReport.SEPARATIONS, 30, 2), (7, ExportReport.SEPARATIONS, 30, 2)]


@pytest.mark.asyncio
async def test_sellers_join_leads_and_separations_and_skip_who_left_without_activity(monkeypatch, recorded):
    async def people(scope):
        return [
            {"user_id": 1, "name": "Grecia", "is_active": True, "leads": 10, "won": 3, "lost": 2},
            {"user_id": 2, "name": "Lucía", "is_active": True, "leads": 0, "won": 0, "lost": 0},
            {"user_id": 3, "name": "Se fue", "is_active": False, "leads": 0, "won": 0, "lost": 0},
            {"user_id": 4, "name": "Se fue con ventas", "is_active": False, "leads": 0, "won": 0, "lost": 0},
            {"user_id": None, "name": "Sin asignar", "is_active": True, "leads": 4, "won": 0, "lost": 1},
        ]

    async def separations(scope):
        return {
            "registered": {2: {"count": 2, "amount": 150.0}, 4: {"count": 1, "amount": 30.0}},
            "owned": {1: {"count": 2, "amount": 150.0}, None: {"count": 1, "amount": 30.0}},
        }

    monkeypatch.setattr(export.leads_queries, "leads_by_user", people)
    monkeypatch.setattr(export.appointments_queries, "separations_by_user", separations)

    exported = await export.build_export(ExportReport.SELLERS, 30, 1, personal_data=True)
    rows = read_sheet(exported.content)
    assert [row[0] for row in rows[1:]] == ["Grecia", "Lucía", "Se fue con ventas", "Sin asignar"]
    assert rows[1] == ["Grecia", "Sí", 10.0, 3.0, 2.0, 0.0, 0.0, 2.0, 150.0]
    assert rows[2] == ["Lucía", "Sí", 0.0, 0.0, 0.0, 2.0, 150.0, 0.0, 0.0]
    assert recorded == [(1, ExportReport.SELLERS, 30, 4)]


@pytest.mark.asyncio
async def test_the_backup_has_every_sheet_and_custom_fields_that_hold_data(monkeypatch, recorded):
    lead = {
        "id": "l-1", "name": "Ana", "phone": "+51999", "stage": "Agendado", "service": "Hifu", "origin": "Anuncio",
        "seller": "Grecia", "created_at": datetime(2026, 11, 1, tzinfo=timezone.utc), "last_message_at": None,
        "lost_reason": None, "objection": None, "no_shows": 1, "follow_ups": None, "notes": None,
        "custom_fields": {"distrito": "Surco", "viejo": "dato", "intereses": ["Botox", "Hifu"], "vacio": ""},
    }

    async def leads(start):
        assert start is None
        return [lead]

    async def tags(start):
        return {"l-1": ["VIP", "Volver a llamar"]}

    async def definitions(entity_type, *, include_inactive=False):
        assert (entity_type, include_inactive) == ("lead", True)
        return [
            {"key": "distrito", "label": "Distrito", "is_active": True},
            {"key": "intereses", "label": "Intereses", "is_active": True},
            {"key": "viejo", "label": "Campo retirado", "is_active": False},
            {"key": "vacio", "label": "Retirado y vacío", "is_active": False},
        ]

    async def appointments():
        return [_separation(status="Duplicada")]

    async def tasks():
        return [{
            "lead_name": "Ana", "lead_phone": "+51999", "title": "Llamar", "description": None, "task_type": "Llamada",
            "status": "Pendiente", "priority": "Alta", "due_at": datetime(2026, 11, 3, tzinfo=timezone.utc),
            "assigned_user_name": "Grecia", "created_at": datetime(2026, 11, 1, tzinfo=timezone.utc), "completed_at": None,
        }]

    async def services(include_inactive=False):
        assert include_inactive
        return [
            {"name": "Hifu", "is_active": True, "packages": [
                {"name": "3 sesiones", "sessions": 3, "price": Decimal("900"), "notes": None, "is_active": True},
                {"name": "1 sesión", "sessions": 1, "price": Decimal("350"), "notes": None, "is_active": False},
            ]},
            {"name": "Consulta", "is_active": False, "packages": []},
        ]

    monkeypatch.setattr(export.leads_queries, "lead_export_rows", leads)
    monkeypatch.setattr(export.tags_queries, "tag_names_by_lead", tags)
    monkeypatch.setattr(export, "list_definitions", definitions)
    monkeypatch.setattr(export.appointments_queries, "appointment_export_rows", appointments)
    monkeypatch.setattr(export, "export_tasks", tasks)
    monkeypatch.setattr(export, "list_lead_services", services)

    exported = await export.build_export(ExportReport.BACKUP, 30, 1, personal_data=True)

    assert sheet_names(exported.content) == ["Leads", "Citas", "Tareas", "Servicios y paquetes"]
    leads_sheet = read_sheet(exported.content, 1)
    assert leads_sheet[0][-3:] == ["Distrito", "Intereses", "Campo retirado"]
    assert leads_sheet[1][-3:] == ["Surco", "Botox, Hifu", "dato"]
    assert leads_sheet[1][6] == "VIP, Volver a llamar"
    assert read_sheet(exported.content, 2)[1][9] == "Duplicada"
    assert read_sheet(exported.content, 3)[1][2] == "Llamar"
    assert read_sheet(exported.content, 4)[1:] == [
        ["Hifu", "Sí", "3 sesiones", 3.0, 900.0, None, "Sí"],
        ["Hifu", "Sí", "1 sesión", 1.0, 350.0, None, "No"],
        ["Consulta", "No"],
    ]
    # El respaldo no tiene período: se registra sin días y el nombre no los lleva.
    assert recorded == [(1, ExportReport.BACKUP, None, 6)]
    assert exported.filename.startswith("respaldo-") and "dias" not in exported.filename
