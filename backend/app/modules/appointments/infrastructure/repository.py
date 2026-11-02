"""Las citas en PostgreSQL."""

from __future__ import annotations

from datetime import date, datetime, timezone
from decimal import Decimal

from sqlalchemy import func, insert, select, update

from app.db.models.appointments import Appointment
from app.db.models.leads import Lead
from app.db.uow import session_scope
from app.integrations.whatsapp.identity import lead_id_for_identifier
from app.modules.appointments.queries import _query, _serialize

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

    async def record_integrations(self, appointment_id: int, *, clear_calendar_sync_error: bool = False, **values) -> dict:
        changes = {key: value for key, value in values.items() if key in _INTEGRATION_FIELDS and value is not None}
        if clear_calendar_sync_error:
            changes["calendar_sync_error"] = None
        async with session_scope() as session:
            if changes:
                await session.execute(update(Appointment).where(Appointment.id == appointment_id).values(**changes))
            row = (await session.execute(_query().where(Appointment.id == appointment_id))).mappings().one()
        return _serialize(row)


class SqlLeadMatcher:
    async def by_whatsapp_identity(self, e164: str) -> str | None:
        return await lead_id_for_identifier(e164)

    async def by_phone_tail(self, tail: str) -> str | None:
        lead_tail = func.right(func.regexp_replace(Lead.telefono, r"\D", "", "g"), len(tail))
        async with session_scope() as session:
            matches = (await session.execute(
                select(Lead.id).where(Lead.telefono.is_not(None), lead_tail == tail).limit(2)
            )).scalars().all()
        return matches[0] if len(matches) == 1 else None
