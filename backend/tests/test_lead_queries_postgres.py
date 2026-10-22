"""Lado de lectura del lead y alta mínima de n8n, contra PostgreSQL real."""

from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from sqlalchemy import insert

from app.db.models.conversations import WspMessage
from app.db.uow import session_scope
from app.modules.leads.infrastructure.repository import ensure_lead_stub
from app.modules.leads.queries import fetch_lead_raw, fetch_messages_raw
from app.tenancy.context import tenant_context
from tests.postgres_fixtures import app_engine, pg_dsn, tenant  # noqa: F401


async def test_a_missing_lead_reads_as_none(tenant):
    with tenant_context(tenant):
        assert await fetch_lead_raw(str(uuid4())) is None


async def test_the_raw_row_is_json_safe(tenant):
    lead_id = str(uuid4())
    seen_at = datetime(2026, 9, 3, 10, 0, tzinfo=timezone.utc)
    with tenant_context(tenant):
        await ensure_lead_stub(lead_id, seen_at, "Facebook Ads")
        row = await fetch_lead_raw(lead_id)
    assert str(row["id"]) == lead_id
    assert row["estado"] == "nuevo"
    assert row["origen"] == "Facebook Ads"
    assert row["ultimo_mensaje_at"] == "2026-09-03T10:00:00.000000Z"


async def test_the_stub_never_overwrites_an_existing_lead(tenant):
    lead_id = str(uuid4())
    with tenant_context(tenant):
        await ensure_lead_stub(lead_id, None, "Orgánico")
        await ensure_lead_stub(lead_id, datetime.now(timezone.utc), "Facebook Ads")
        row = await fetch_lead_raw(lead_id)
    assert (row["origen"], row["ultimo_mensaje_at"]) == ("Orgánico", None)


async def test_raw_messages_come_newest_first(tenant):
    lead_id = str(uuid4())
    with tenant_context(tenant):
        await ensure_lead_stub(lead_id, None, None)
        async with session_scope() as session:
            for content in ("a", "b"):
                await session.execute(insert(WspMessage).values(
                    chat_id=lead_id, sender="cliente", content=content,
                    sent_at=datetime.now(timezone.utc), message_type="text",
                ))
        messages = await fetch_messages_raw(lead_id, limit=500)
    assert [message["content"] for message in messages] == ["b", "a"]
