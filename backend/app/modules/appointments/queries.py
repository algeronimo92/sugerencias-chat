"""Lado de lectura de las citas: la lista y el detalle que muestra la app."""

from sqlalchemy import select
from sqlalchemy.orm import aliased

from app.db.models.appointments import Appointment
from app.db.models.auth import User
from app.db.models.leads import Lead
from app.db.uow import session_scope
from app.core.time_format import iso_utc

Creator = aliased(User)
Owner = aliased(User)


def _serialize(row) -> dict:
    return {
        "id": row["id"],
        "created_by_user_id": row["created_by_user_id"],
        "created_by_name": row["created_by_name"],
        "lead_id": row["lead_id"],
        "lead_owner_name": row["lead_owner_name"],
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
            Appointment.lead_id,
            Owner.name.label("lead_owner_name"),
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
        # Ambos por fuera: la cita puede no estar vinculada a un lead, y un lead
        # vinculado puede no tener vendedor asignado.
        .outerjoin(Lead, Lead.id == Appointment.lead_id)
        .outerjoin(Owner, Owner.id == Lead.vendedor_id)
    )


async def list_appointments(limit: int = 300) -> list[dict]:
    stmt = _query().order_by(Appointment.created_at.desc(), Appointment.id.desc()).limit(limit)
    async with session_scope() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [_serialize(row) for row in rows]


async def get_appointment(appointment_id: int) -> dict | None:
    async with session_scope() as session:
        row = (
            await session.execute(_query().where(Appointment.id == appointment_id))
        ).mappings().one_or_none()
    return _serialize(row) if row is not None else None
