"""Las citas en PostgreSQL."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import case, func, insert, or_, select, update

from app.db.models.appointments import Appointment, AppointmentNotice
from app.db.models.leads import Lead
from app.db.uow import session_scope
from app.integrations.whatsapp.identity import lead_id_for_identifier
from app.modules.conversations.ports.message_queries import phoneless_chats_mentioning
from app.modules.conversations.public import NoteAuthor, create_note
from app.modules.leads.public import Actor, LeadAlreadyExists, create_lead, fetch_lead_raw, register_appointment
from app.modules.appointments.queries import _query, _serialize

# Así se reconoce en el CRM el lead que nació de una cita cargada desde Citas.
NEW_LEAD_ORIGIN = "Cita"
# Cuánto atrás se busca el número dictado en un chat sin teléfono: la cita
# se carga mientras se conversa, y una semana cubre al que agenda días después.
CHAT_MENTION_WINDOW = timedelta(days=7)

_INTEGRATION_FIELDS = (
    "status", "n8n_status", "message", "event_link",
    "calendar_event_id", "calendar_sync_status", "calendar_sync_error",
)


class SqlAppointmentRepository:
    async def add(self, values: dict) -> dict:
        async with session_scope() as session:
            appointment_id = (await session.execute(
                insert(Appointment).values(**{
                    **values,
                    "fecha": date.fromisoformat(values["fecha"]),
                    "adelanto": Decimal(str(values["adelanto"])),
                    "created_at": datetime.now(timezone.utc),
                }).returning(Appointment.id)
            )).scalar_one()
        return await self.get(appointment_id)

    async def get(self, appointment_id: int) -> dict | None:
        async with session_scope() as session:
            row = (
                await session.execute(_query().where(Appointment.id == appointment_id))
            ).mappings().one_or_none()
        return _serialize(row) if row is not None else None

    async def latest_real(self) -> dict | None:
        stmt = (
            _query().where(Appointment.test_mode.is_(False), Appointment.dismissed_at.is_(None))
            .order_by(Appointment.created_at.desc(), Appointment.id.desc()).limit(1)
        )
        async with session_scope() as session:
            row = (await session.execute(stmt)).mappings().first()
        return _serialize(row) if row is not None else None

    async def set_dismissed(self, appointment_id: int, *, user_id: int | None, reason: str | None) -> dict | None:
        """Marca la cita como desestimada, o la restaura con ``user_id=None``."""
        values = (
            {"dismissed_at": datetime.now(timezone.utc), "dismissed_by_user_id": user_id, "dismissed_reason": reason}
            if user_id is not None
            else {"dismissed_at": None, "dismissed_by_user_id": None, "dismissed_reason": None}
        )
        async with session_scope() as session:
            result = await session.execute(update(Appointment).where(Appointment.id == appointment_id).values(**values))
            if not result.rowcount:
                return None
            row = (await session.execute(_query().where(Appointment.id == appointment_id))).mappings().one()
        return _serialize(row)

    async def record_integrations(self, appointment_id: int, *, clear_calendar_sync_error: bool = False, **values) -> dict:
        changes = {key: value for key, value in values.items() if key in _INTEGRATION_FIELDS and value is not None}
        if clear_calendar_sync_error:
            changes["calendar_sync_error"] = None
        async with session_scope() as session:
            if changes:
                await session.execute(update(Appointment).where(Appointment.id == appointment_id).values(**changes))
            row = (await session.execute(_query().where(Appointment.id == appointment_id))).mappings().one()
        return _serialize(row)


class SqlAppointmentLeads:
    async def by_whatsapp_identity(self, e164: str) -> str | None:
        return await lead_id_for_identifier(e164)

    async def by_phone_tail(self, tail: str) -> list[str]:
        lead_tail = func.right(func.regexp_replace(Lead.telefono, r"\D", "", "g"), len(tail))
        async with session_scope() as session:
            return list((await session.execute(
                select(Lead.id).where(Lead.telefono.is_not(None), lead_tail == tail).limit(2)
            )).scalars().all())

    async def by_phone_in_chat(self, tail: str) -> list[str]:
        since = datetime.now(timezone.utc) - CHAT_MENTION_WINDOW
        return await phoneless_chats_mentioning(tail, since=since)

    async def create(self, *, phone: str, name: str, actor_user_id: int) -> str:
        try:
            return await create_lead(phone, name, actor=Actor.user(actor_user_id), origen=NEW_LEAD_ORIGIN)
        except LeadAlreadyExists:
            # Un mensaje entrante (u otra cita) dio de alta el número entre la
            # búsqueda y el alta: la cita va a ese lead.
            existing = await lead_id_for_identifier(phone)
            if existing is None:
                raise
            return existing

    async def snapshot(self, lead_id: str) -> dict | None:
        return await fetch_lead_raw(lead_id)

    async def exists(self, lead_id: str) -> bool:
        async with session_scope() as session:
            return await session.scalar(select(Lead.id).where(Lead.id == lead_id)) is not None

    async def register(self, lead_id: str, *, actor_user_id: int, appointment: dict, starts_at,
                       updates: dict, custom_fields: dict, note: str) -> None:
        await register_appointment(
            lead_id, actor=Actor.user(actor_user_id), appointment=appointment,
            starts_at=starts_at, updates=updates, custom_fields=custom_fields,
        )
        # Sin menciones, el nombre del autor no se usa (solo arma el aviso).
        await create_note(lead_id, note, [], NoteAuthor(id=actor_user_id, name=""))


# Un estado de Meta solo avanza: un aviso leído no vuelve a "entregado" si
# los eventos llegan desordenados. "failed" es final.
_DELIVERY_RANK = {"sent": 1, "delivered": 2, "read": 3, "failed": 4}


class SqlAppointmentNotices:
    async def record(self, appointment_id: int, notices: list[dict]) -> None:
        if not notices:
            return
        rows = [
            {
                "appointment_id": appointment_id,
                "audience": notice["audience"],
                "recipient_name": notice["recipient_name"],
                "user_id": notice.get("user_id"),
                "phone": notice.get("phone"),
                "template_id": notice.get("template_id"),
                "status": notice["status"],
                "reason": notice.get("reason"),
                "provider_message_id": notice.get("provider_message_id"),
                "wsp_message_id": notice.get("wsp_message_id"),
                "delivery_status": "sent" if notice["status"] == "sent" else None,
            }
            for notice in notices
        ]
        async with session_scope() as session:
            await session.execute(insert(AppointmentNotice), rows)

    async def record_delivery(
        self, *, provider_message_id: str | None, wsp_message_id: int | None, status: str, at: datetime | None,
    ) -> int:
        matches = []
        if provider_message_id:
            matches.append(AppointmentNotice.provider_message_id == provider_message_id)
        if wsp_message_id is not None:
            matches.append(AppointmentNotice.wsp_message_id == wsp_message_id)
        when = at or datetime.now(timezone.utc)
        rank = _DELIVERY_RANK[status]
        current_rank = case(
            *((AppointmentNotice.delivery_status == name, value) for name, value in _DELIVERY_RANK.items()),
            else_=0,
        )
        values: dict = {"delivery_status": status}
        if status in ("delivered", "read"):
            values["delivered_at"] = func.coalesce(AppointmentNotice.delivered_at, when)
        if status == "read":
            values["read_at"] = func.coalesce(AppointmentNotice.read_at, when)
        stmt = (
            update(AppointmentNotice)
            .where(or_(*matches), current_rank < rank)
            .values(**values)
        )
        async with session_scope() as session:
            result = await session.execute(stmt)
        return result.rowcount or 0
