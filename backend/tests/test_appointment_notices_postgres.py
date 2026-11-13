"""El registro de avisos de cita contra PostgreSQL: se guardan con la cita,
el historial los devuelve y los estados de Meta solo los hacen avanzar."""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from app.db.models.appointments import Appointment
from app.db.models.auth import User
from app.db.uow import session_scope
from app.modules.appointments.infrastructure.repository import SqlAppointmentNotices
from app.modules.appointments.queries import list_appointments
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401


async def _appointment() -> int:
    async with session_scope() as session:
        user = User(
            email=f"asesora-{uuid4().hex[:6]}@example.test", name="Asesora", password_hash="!",
            role="vendedor", is_active=True, created_at=datetime.now(timezone.utc),
        )
        session.add(user)
        await session.flush()
        appointment = Appointment(
            created_by_user_id=user.id, nombre_completo="Cliente", telefono="999", tratamiento="Limpieza",
            fecha=date(2026, 12, 1), hora="10:00", vendedor="Asesora", status="created", test_mode=False,
            created_at=datetime.now(timezone.utc),
        )
        session.add(appointment)
        await session.flush()
        return appointment.id


async def test_notices_are_listed_with_their_appointment_and_meta_only_moves_them_forward(tenant) -> None:
    with tenant_context(tenant):
        appointment_id = await _appointment()
        notices = SqlAppointmentNotices()
        await notices.record(appointment_id, [
            {"audience": "client", "recipient_name": "Cliente", "status": "sent", "wsp_message_id": 777},
            {"audience": "staff", "recipient_name": "Admin", "user_id": 1, "phone": "51900000001",
             "status": "sent", "provider_message_id": "wamid.admin"},
            {"audience": "staff", "recipient_name": "Rosa", "user_id": 2, "status": "skipped",
             "reason": "Sin WhatsApp cargado en Usuarios"},
        ])

        read_at = datetime.now(timezone.utc)
        assert await notices.record_delivery(
            provider_message_id="wamid.admin", wsp_message_id=None, status="read", at=read_at,
        ) == 1
        # Un "entregado" que llega tarde no deshace el "leído".
        assert await notices.record_delivery(
            provider_message_id="wamid.admin", wsp_message_id=None, status="delivered", at=read_at - timedelta(seconds=5),
        ) == 0
        # El del cliente se reconoce por su mensaje del CRM.
        assert await notices.record_delivery(
            provider_message_id="wamid.cliente", wsp_message_id=777, status="delivered", at=read_at,
        ) == 1

        [item] = [row for row in await list_appointments() if row["id"] == appointment_id]

    by_name = {notice["recipient_name"]: notice for notice in item["notices"]}
    assert [notice["audience"] for notice in item["notices"]] == ["client", "staff", "staff"]
    assert by_name["Cliente"]["delivery_status"] == "delivered"
    assert by_name["Admin"]["delivery_status"] == "read"
    assert by_name["Admin"]["delivered_at"] is not None and by_name["Admin"]["read_at"] is not None
    assert by_name["Rosa"]["status"] == "skipped" and by_name["Rosa"]["delivery_status"] is None
