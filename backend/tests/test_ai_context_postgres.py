"""Contexto que recibe el analista de IA, contra PostgreSQL real."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import insert

from app.db.models.conversations import WspMessage
from app.db.uow import session_scope
from app.modules.ai.ai_context import fetch_analysis_context
from app.modules.leads.infrastructure.repository import ensure_lead_stub
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401


async def test_meta_system_notices_are_kept_out_of_the_conversation(tenant):
    lead_id = str(uuid4())
    now = datetime.now(timezone.utc)
    with tenant_context(tenant):
        await ensure_lead_stub(lead_id, None, None)
        async with session_scope() as session:
            await session.execute(insert(WspMessage).values(
                chat_id=lead_id, sender="cliente", content="Hola", sent_at=now - timedelta(minutes=2),
                message_type="text",
            ))
            await session.execute(insert(WspMessage).values(
                chat_id=lead_id, sender="cliente", content="El cliente cambió de número",
                sent_at=now - timedelta(minutes=1), message_type="system",
                message_subtype="user_changed_number",
            ))
        context = await fetch_analysis_context(lead_id)

    assert [message["content"] for message in context["messages"]] == ["Hola"]
    [event] = context["system_events"]
    assert event["message_subtype"] == "user_changed_number"
    assert event["text"] == "El cliente cambió de número"
    assert context["context_revision"].startswith("v1:")


async def test_a_missing_lead_has_no_context(tenant):
    with tenant_context(tenant):
        assert await fetch_analysis_context(str(uuid4())) is None
