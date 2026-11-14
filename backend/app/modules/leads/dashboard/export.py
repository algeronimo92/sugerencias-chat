"""Reportes del dashboard en Excel.

Cuatro archivos, cada uno para una tarea concreta de quien dirige:

- **separaciones**: una fila por cita separada, para cuadrar con la caja;
- **vendedoras**: una fila por persona, para pagar comisiones;
- **leads**: el embudo fuera del sistema, o para quien lleva la pauta;
- **respaldo**: todo lo del negocio, para que pueda irse con sus datos.

No se exportan conversaciones: son muy voluminosas, traen datos de salud y
nadie las analiza en una planilla.

Cada descarga queda registrada en ``data_exports`` con quién la pidió.
"""

from dataclasses import dataclass
from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import insert

from app.db.models.leads import DataExport
from app.db.uow import session_scope
from app.modules.catalogs.ports.custom_fields import list_definitions
from app.modules.catalogs.public import list_lead_services
from app.modules.leads.dashboard import appointments_queries, leads_queries, tags_queries
from app.modules.leads.dashboard.currency import business_currency
from app.modules.leads.dashboard.scope import BUSINESS_TIMEZONE, SCOPE_TEAM, DashboardScope, build_scope
from app.modules.leads.dashboard.workbook import Column, Sheet, build_workbook
from app.modules.tasks.public import export_tasks


class ExportReport(StrEnum):
    SEPARATIONS = "separaciones"
    SELLERS = "vendedoras"
    LEADS = "leads"
    BACKUP = "respaldo"


# El analista (el contador, la agencia) ve los números, pero no se lleva la
# base de pacientes: ni la lista de leads, ni el respaldo, ni teléfonos o DNI.
ANALYST_REPORTS = frozenset({ExportReport.SEPARATIONS, ExportReport.SELLERS})
_PERSONAL_HEADERS = frozenset({"DNI", "Teléfono"})

XLSX_MEDIA_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


@dataclass(frozen=True)
class ExportFile:
    filename: str
    content: bytes
    row_count: int


def _yes_no(value: Any) -> str:
    return "Sí" if value else "No"


def _money_header(label: str, currency: str | None) -> str:
    return f"{label} ({currency})" if currency else label


# --- Separaciones ---------------------------------------------------------------

def _appointment_columns(currency: str | None) -> list[Column]:
    return [
        Column("Fecha de separación", "datetime", 18),
        Column("Fecha de la cita", "date", 14),
        Column("Hora", "text", 8),
        Column("Paciente", "text", 28),
        Column("DNI", "text", 12),
        Column("Teléfono", "text", 16),
        Column("Tratamiento", "text", 24),
        Column(_money_header("Adelanto", currency), "money", 14),
        Column("Comprobante", "text", 12),
        Column("Estado", "text", 12),
        Column("Registró", "text", 20),
        Column("Vendedora del lead", "text", 20),
        Column("Origen del lead", "text", 20),
    ]


def _appointment_row(row: dict) -> list[Any]:
    return [
        row["created_at"], row["date"], row["time"], row["name"], row["dni"], row["phone"], row["treatment"],
        row["amount"], _yes_no(row["receipt"]), row["status"], row["registered_by"], row["owner"], row["origin"],
    ]


def _without_personal_data(sheet: Sheet) -> Sheet:
    keep = [index for index, column in enumerate(sheet.columns) if column.header not in _PERSONAL_HEADERS]
    return Sheet(
        sheet.name,
        [sheet.columns[index] for index in keep],
        [[row[index] for index in keep] for row in sheet.rows],
    )


async def _separations(scope: DashboardScope, currency: str | None) -> list[Sheet]:
    rows = await appointments_queries.separation_export_rows(scope)
    return [Sheet("Separaciones", _appointment_columns(currency), [_appointment_row(row) for row in rows])]


# --- Vendedoras ---------------------------------------------------------------

async def _sellers(scope: DashboardScope, currency: str | None) -> list[Sheet]:
    people = await leads_queries.leads_by_user(scope)
    separations = await appointments_queries.separations_by_user(scope)
    empty = {"count": 0, "amount": 0.0}
    columns = [
        Column("Persona", "text", 24),
        Column("Activa", "text", 8),
        Column("Leads nuevos asignados", "integer", 14),
        Column("De esos, ganados", "integer", 12),
        Column("De esos, perdidos", "integer", 12),
        Column("Separaciones que registró", "integer", 14),
        Column(_money_header("Adelantos que registró", currency), "money", 16),
        Column("Separaciones de su cartera", "integer", 14),
        Column(_money_header("Adelantos de su cartera", currency), "money", 16),
    ]
    # Separaciones de clientas sin vendedora (o sin lead) aunque en el período
    # no haya entrado ningún lead sin asignar: la plata no puede desaparecer.
    if all(person["user_id"] is not None for person in people) and (
        None in separations["registered"] or None in separations["owned"]
    ):
        people = [*people, {"user_id": None, "name": "Sin asignar", "is_active": True, "leads": 0, "won": 0, "lost": 0}]
    rows = []
    for person in people:
        registered = separations["registered"].get(person["user_id"], empty)
        owned = separations["owned"].get(person["user_id"], empty)
        # Quien ya no trabaja ahí y no tuvo movimiento en el período no es
        # una fila útil para pagar comisiones.
        moved = person["leads"] or registered["count"] or owned["count"]
        if not person["is_active"] and not moved:
            continue
        rows.append([
            person["name"], _yes_no(person["is_active"]), person["leads"], person["won"], person["lost"],
            registered["count"], registered["amount"], owned["count"], owned["amount"],
        ])
    return [Sheet("Vendedoras", columns, rows)]


# --- Leads --------------------------------------------------------------------

def _custom_value(value: Any) -> Any:
    if isinstance(value, bool):
        return _yes_no(value)
    if isinstance(value, list):
        return ", ".join(str(item) for item in value)
    return value


async def _lead_sheet(name: str, start: datetime | None) -> Sheet:
    rows = await leads_queries.lead_export_rows(start)
    tags = await tags_queries.tag_names_by_lead(start)
    # Los campos desactivados se exportan si algún lead los tiene llenos: el
    # dato existe y es del negocio, aunque ya no se pida en el formulario.
    used = {key for row in rows for key, value in (row["custom_fields"] or {}).items() if value not in (None, "", [])}
    custom = [
        field for field in await list_definitions("lead", include_inactive=True)
        if field["is_active"] or field["key"] in used
    ]
    columns = [
        Column("Nombre", "text", 26),
        Column("Teléfono", "text", 16),
        Column("Etapa", "text", 16),
        Column("Servicio de interés", "text", 22),
        Column("Origen", "text", 18),
        Column("Vendedora", "text", 20),
        Column("Etiquetas", "text", 24),
        Column("Fecha de ingreso", "datetime", 18),
        Column("Último mensaje", "datetime", 18),
        Column("Motivo de pérdida", "text", 20),
        Column("Objeción", "text", 18),
        Column("Inasistencias", "integer", 12),
        Column("Toques de seguimiento", "integer", 12),
        Column("Notas", "text", 30),
        *[Column(field["label"], "text", 18) for field in custom],
    ]
    sheet_rows = [
        [
            row["name"], row["phone"], row["stage"], row["service"], row["origin"], row["seller"],
            ", ".join(tags.get(str(row["id"]), [])), row["created_at"], row["last_message_at"],
            row["lost_reason"], row["objection"], row["no_shows"], row["follow_ups"], row["notes"],
            *[_custom_value((row["custom_fields"] or {}).get(field["key"])) for field in custom],
        ]
        for row in rows
    ]
    return Sheet(name, columns, sheet_rows)


async def _leads(scope: DashboardScope) -> list[Sheet]:
    return [await _lead_sheet("Leads", scope.start)]


# --- Respaldo -----------------------------------------------------------------

async def _backup(currency: str | None) -> list[Sheet]:
    leads = await _lead_sheet("Leads", None)
    appointments = await appointments_queries.appointment_export_rows()
    tasks = await export_tasks()
    services = await list_lead_services(include_inactive=True)
    service_rows = []
    for service in services:
        packages = service["packages"] or [None]
        for package in packages:
            service_rows.append([
                service["name"], _yes_no(service["is_active"]),
                package["name"] if package else None,
                package["sessions"] if package else None,
                package["price"] if package else None,
                package["notes"] if package else None,
                _yes_no(package["is_active"]) if package else None,
            ])
    return [
        leads,
        Sheet("Citas", _appointment_columns(currency), [_appointment_row(row) for row in appointments]),
        Sheet(
            "Tareas",
            [
                Column("Lead", "text", 24), Column("Teléfono", "text", 16), Column("Tarea", "text", 28),
                Column("Detalle", "text", 30), Column("Tipo", "text", 12), Column("Estado", "text", 12),
                Column("Prioridad", "text", 10), Column("Vence", "datetime", 18), Column("Asignada a", "text", 20),
                Column("Creada", "datetime", 18), Column("Completada", "datetime", 18),
            ],
            [
                [
                    task["lead_name"], task["lead_phone"], task["title"], task["description"], task["task_type"],
                    task["status"], task["priority"], task["due_at"], task["assigned_user_name"],
                    task["created_at"], task["completed_at"],
                ]
                for task in tasks
            ],
        ),
        Sheet(
            "Servicios y paquetes",
            [
                Column("Servicio", "text", 26), Column("Servicio activo", "text", 10), Column("Paquete", "text", 24),
                Column("Sesiones", "integer", 10), Column(_money_header("Precio", currency), "money", 14),
                Column("Notas del paquete", "text", 30), Column("Paquete activo", "text", 10),
            ],
            service_rows,
        ),
    ]


# --- Armado y registro ----------------------------------------------------------

async def _record(user_id: int, report: ExportReport, days: int | None, row_count: int) -> None:
    async with session_scope() as session:
        await session.execute(
            insert(DataExport).values(user_id=user_id, report=report.value, period_days=days, row_count=row_count)
        )


async def build_export(report: ExportReport, days: int, user_id: int, *, personal_data: bool) -> ExportFile:
    """Arma el archivo del reporte y deja constancia de la descarga.

    ``personal_data`` en falso quita teléfonos y DNI (el rol analista)."""
    currency = await business_currency()
    scope = build_scope(days, SCOPE_TEAM, user_id)
    if report == ExportReport.SEPARATIONS:
        sheets = await _separations(scope, currency)
    elif report == ExportReport.SELLERS:
        sheets = await _sellers(scope, currency)
    elif report == ExportReport.LEADS:
        sheets = await _leads(scope)
    else:
        sheets = await _backup(currency)
    if not personal_data:
        sheets = [_without_personal_data(sheet) for sheet in sheets]
    row_count = sum(len(sheet.rows) for sheet in sheets)
    content = build_workbook(sheets)
    period = None if report == ExportReport.BACKUP else days
    await _record(user_id, report, period, row_count)
    today = datetime.now(BUSINESS_TIMEZONE).date().isoformat()
    filename = f"{report.value}-{today}.xlsx" if period is None else f"{report.value}-{days}-dias-{today}.xlsx"
    return ExportFile(filename=filename, content=content, row_count=row_count)


__all__ = ["ANALYST_REPORTS", "ExportFile", "ExportReport", "XLSX_MEDIA_TYPE", "build_export"]
