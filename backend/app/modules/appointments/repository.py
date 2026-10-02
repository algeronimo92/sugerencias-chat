from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import insert, select, update
from sqlalchemy.orm import aliased

from app.db.models.appointments import Appointment
from app.db.models.auth import User
from app.db.session import get_sessionmaker
from app.core.time_format import iso_utc

Creator = aliased(User)


def _serialize(row) -> dict:
    return {
        "id": row["id"],
        "created_by_user_id": row["created_by_user_id"],
        "created_by_name": row["created_by_name"],
        "nombre_completo": row["nombre_completo"],
        "dni": row["dni"],
        "telefono": row["telefono"],
        "tratamiento": row["tratamiento"],
        "detalle": row["detalle"],
        "fecha": row["fecha"].isoformat() if row["fecha"] else None,
        "hora": row["hora"],
        "vendedor": row["vendedor"],
        "adelanto": float(row["adelanto"]),
        "duration_minutes": row["duration_minutes"],
        "custom_fields": row["custom_fields"] or {},
        "comprobante_filename": row["comprobante_filename"],
        "test_mode": row["test_mode"],
        "status": row["status"],
        "n8n_status": row["n8n_status"],
        "message": row["message"],
        "event_link": row["event_link"],
        "calendar_event_id": row["calendar_event_id"],
        "calendar_sync_status": row["calendar_sync_status"],
        "calendar_sync_error": row["calendar_sync_error"],
        "created_at": iso_utc(row["created_at"]),
    }


def _query():
    return (
        select(
            Appointment.id,
            Appointment.created_by_user_id,
            Creator.name.label("created_by_name"),
            Appointment.nombre_completo,
            Appointment.dni,
            Appointment.telefono,
            Appointment.tratamiento,
            Appointment.detalle,
            Appointment.fecha,
            Appointment.hora,
            Appointment.vendedor,
            Appointment.adelanto,
            Appointment.duration_minutes,
            Appointment.custom_fields,
            Appointment.comprobante_filename,
            Appointment.test_mode,
            Appointment.status,
            Appointment.n8n_status,
            Appointment.message,
            Appointment.event_link,
            Appointment.calendar_event_id,
            Appointment.calendar_sync_status,
            Appointment.calendar_sync_error,
            Appointment.created_at,
        )
        .join(Creator, Creator.id == Appointment.created_by_user_id)
    )


async def list_appointments(limit: int = 300) -> list[dict]:
    stmt = _query().order_by(Appointment.created_at.desc(), Appointment.id.desc()).limit(limit)
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [_serialize(row) for row in rows]


async def get_appointment(appointment_id: int) -> dict | None:
    async with get_sessionmaker()() as session:
        row = (
            await session.execute(_query().where(Appointment.id == appointment_id))
        ).mappings().one_or_none()
    return _serialize(row) if row is not None else None


async def create_appointment_record(
    *,
    created_by_user_id: int,
    nombre_completo: str,
    dni: str,
    telefono: str,
    tratamiento: str,
    detalle: str,
    fecha: str,
    hora: str,
    vendedor: str,
    adelanto: float,
    duration_minutes: int,
    custom_fields: dict,
    comprobante_filename: str | None,
    test_mode: bool,
    status: str,
    n8n_status: str | None,
    message: str | None,
    event_link: str | None,
    calendar_sync_status: str = "pending",
) -> dict:
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        appointment_id = (await session.execute(
            insert(Appointment).values(
                created_by_user_id=created_by_user_id,
                nombre_completo=nombre_completo,
                dni=dni,
                telefono=telefono,
                tratamiento=tratamiento,
                detalle=detalle,
                fecha=date.fromisoformat(fecha),
                hora=hora,
                vendedor=vendedor,
                adelanto=Decimal(str(adelanto)),
                duration_minutes=duration_minutes,
                custom_fields=custom_fields,
                comprobante_filename=comprobante_filename,
                test_mode=test_mode,
                status=status,
                n8n_status=n8n_status,
                message=message,
                event_link=event_link,
                calendar_sync_status=calendar_sync_status,
                created_at=now,
            ).returning(Appointment.id)
        )).scalar_one()
        await session.commit()
    async with get_sessionmaker()() as session:
        row = (await session.execute(_query().where(Appointment.id == appointment_id))).mappings().one()
    return _serialize(row)


async def update_appointment_integrations(
    appointment_id: int,
    *,
    status: str | None = None,
    n8n_status: str | None = None,
    message: str | None = None,
    event_link: str | None = None,
    calendar_event_id: str | None = None,
    calendar_sync_status: str | None = None,
    calendar_sync_error: str | None = None,
    clear_calendar_sync_error: bool = False,
) -> dict:
    values = {
        key: value
        for key, value in {
            "status": status,
            "n8n_status": n8n_status,
            "message": message,
            "event_link": event_link,
            "calendar_event_id": calendar_event_id,
            "calendar_sync_status": calendar_sync_status,
            "calendar_sync_error": calendar_sync_error,
        }.items()
        if value is not None
    }
    if clear_calendar_sync_error:
        values["calendar_sync_error"] = None
    async with get_sessionmaker()() as session:
        if values:
            await session.execute(update(Appointment).where(Appointment.id == appointment_id).values(**values))
            await session.commit()
        row = (await session.execute(_query().where(Appointment.id == appointment_id))).mappings().one()
    return _serialize(row)
