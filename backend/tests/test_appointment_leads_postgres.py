"""El emparejamiento cita -> lead por cola de teléfono, contra PostgreSQL."""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import update

from app.db.models.leads import Lead
from app.db.uow import session_scope
from app.modules.appointments.infrastructure.repository import SqlLeadMatcher
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

        assert await SqlLeadMatcher().by_phone_tail("987654321") == lead_id


async def test_two_leads_with_the_same_tail_are_not_guessed(tenant):
    with tenant_context(tenant):
        await _lead_with_phone("51987654321")
        await _lead_with_phone("987654321")

        assert await SqlLeadMatcher().by_phone_tail("987654321") is None
