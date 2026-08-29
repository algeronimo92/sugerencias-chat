from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import insert, select
from sqlalchemy.orm import aliased

from db.models import Appointment, User
from db.session import get_sessionmaker

Creator = aliased(User)


def _ts(value):
    return value.isoformat().replace("+00:00", "Z") if value else None


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
        "comprobante_filename": row["comprobante_filename"],
        "test_mode": row["test_mode"],
        "status": row["status"],
        "n8n_status": row["n8n_status"],
        "message": row["message"],
        "event_link": row["event_link"],
        "created_at": _ts(row["created_at"]),
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
            Appointment.comprobante_filename,
            Appointment.test_mode,
            Appointment.status,
            Appointment.n8n_status,
            Appointment.message,
            Appointment.event_link,
            Appointment.created_at,
        )
        .join(Creator, Creator.id == Appointment.created_by_user_id)
    )


async def list_appointments(limit: int = 300) -> list[dict]:
    stmt = _query().order_by(Appointment.created_at.desc(), Appointment.id.desc()).limit(limit)
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [_serialize(row) for row in rows]


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
    comprobante_filename: str | None,
    test_mode: bool,
    status: str,
    n8n_status: str | None,
    message: str | None,
    event_link: str | None,
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
                comprobante_filename=comprobante_filename,
                test_mode=test_mode,
                status=status,
                n8n_status=n8n_status,
                message=message,
                event_link=event_link,
                created_at=now,
            ).returning(Appointment.id)
        )).scalar_one()
        await session.commit()
    async with get_sessionmaker()() as session:
        row = (await session.execute(_query().where(Appointment.id == appointment_id))).mappings().one()
    return _serialize(row)
