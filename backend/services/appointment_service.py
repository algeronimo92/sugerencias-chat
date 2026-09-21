import logging
from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import func, insert, select
from sqlalchemy.orm import aliased

from db.models import Appointment, Lead, User
from db.session import get_sessionmaker
from services.phone_utils import (
    PhoneValidationError,
    digits_to_jid,
    effective_country_code,
    normalize_phone,
)
from services.whatsapp_identity_service import lead_id_for_jid

logger = logging.getLogger(__name__)

Creator = aliased(User)
Owner = aliased(User)

# Cola del número que se compara contra los leads cuando el alias de WhatsApp no
# existe: en Perú son los 9 dígitos del celular, sin el código de país. Alcanza
# para emparejar un teléfono escrito con o sin +51.
PHONE_TAIL_DIGITS = 9


async def resolve_lead_for_phone(telefono: str) -> str | None:
    """El lead dueño de ese teléfono, o None si no se puede afirmar cuál es.

    Primero por el alias de WhatsApp, que es la identidad canónica del CRM
    (`whatsapp_identities`); si el número nunca chateó, cae a comparar la cola
    del teléfono contra `leads`, y **solo** acepta el resultado cuando un único
    lead coincide. Con dos candidatos devuelve None a propósito: una cita colgada
    del lead equivocado es peor que una cita sin vincular.
    """
    try:
        e164 = normalize_phone(telefono, await effective_country_code())
    except PhoneValidationError:
        return None
    except Exception:
        # La resolución del lead es un extra sobre el registro de la cita; que
        # falle no puede impedir que la cita se guarde.
        logger.exception("No se pudo normalizar el teléfono de la cita")
        return None

    lead_id = await lead_id_for_jid(digits_to_jid(e164))
    if lead_id is not None:
        return lead_id

    tail = e164[-PHONE_TAIL_DIGITS:]
    if len(tail) < PHONE_TAIL_DIGITS:
        return None
    lead_tail = func.right(func.regexp_replace(Lead.telefono, r"\D", "", "g"), PHONE_TAIL_DIGITS)
    async with get_sessionmaker()() as session:
        matches = (await session.execute(
            select(Lead.id).where(Lead.telefono.is_not(None), lead_tail == tail).limit(2)
        )).scalars().all()
    return matches[0] if len(matches) == 1 else None


def _ts(value):
    return value.isoformat().replace("+00:00", "Z") if value else None


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
            Appointment.comprobante_filename,
            Appointment.test_mode,
            Appointment.status,
            Appointment.n8n_status,
            Appointment.message,
            Appointment.event_link,
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
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [_serialize(row) for row in rows]


async def create_appointment_record(
    *,
    created_by_user_id: int,
    lead_id: str | None,
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
                lead_id=lead_id,
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
