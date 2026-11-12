"""El emparejamiento cita -> lead por cola de teléfono, contra PostgreSQL."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import insert, update

from app.db.models.conversations import WspMessage
from app.db.models.leads import Lead
from app.db.uow import session_scope
from app.modules.appointments.infrastructure.repository import SqlAppointmentLeads
from app.modules.leads.infrastructure.repository import ensure_lead_stub
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401


async def _lead_with_phone(phone: str) -> str:
    chat_id = str(uuid4())
    await ensure_lead_stub(chat_id, None, None)
    async with session_scope() as session:
        await session.execute(update(Lead).where(Lead.id == chat_id).values(telefono=phone))
    return chat_id


async def test_a_single_lead_with_that_tail_is_linked(tenant):
    with tenant_context(tenant):
        lead_id = await _lead_with_phone("+51 987-654-321")

        assert await SqlAppointmentLeads().by_phone_tail("987654321") == [lead_id]


async def test_two_leads_with_the_same_tail_are_not_guessed(tenant):
    with tenant_context(tenant):
        await _lead_with_phone("51987654321")
        await _lead_with_phone("987654321")

        # Los dos vuelven: el caso de uso no adivina ni crea un tercero.
        assert len(await SqlAppointmentLeads().by_phone_tail("987654321")) == 2


async def _phoneless_lead_saying(content: str, *, sender: str = "cliente", days_ago: int = 0) -> str:
    chat_id = str(uuid4())
    await ensure_lead_stub(chat_id, None, None)
    async with session_scope() as session:
        await session.execute(insert(WspMessage).values(
            chat_id=chat_id, sender=sender, content=content, message_type="text",
            sent_at=datetime.now(timezone.utc) - timedelta(days=days_ago),
        ))
    return chat_id


async def test_a_phoneless_lead_that_dictated_the_number_is_found(tenant):
    """Así dictó su número la clienta de la cita 361: nombre, DNI y celular
    en un solo mensaje, con saltos de línea."""
    with tenant_context(tenant):
        lead_id = await _phoneless_lead_saying("Ana Pérez Rojas\n40404040\n971 000 132")

        assert await SqlAppointmentLeads().by_phone_in_chat("971000132") == [lead_id]


async def test_only_recent_client_messages_of_phoneless_leads_count(tenant):
    with tenant_context(tenant):
        # Lo escribió el vendedor, no el cliente.
        await _phoneless_lead_saying("Te escribo al 971000132", sender="vendedor")
        # Hace más de una semana.
        await _phoneless_lead_saying("mi número 971000132", days_ago=9)
        # El lead ya tiene teléfono: lo resuelve la búsqueda por teléfono.
        with_phone = await _phoneless_lead_saying("971000132")
        async with session_scope() as session:
            await session.execute(update(Lead).where(Lead.id == with_phone).values(telefono="51999888777"))

        assert await SqlAppointmentLeads().by_phone_in_chat("971000132") == []
