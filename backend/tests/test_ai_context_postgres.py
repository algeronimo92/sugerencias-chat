"""Contexto que recibe el analista de IA, contra PostgreSQL real."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import uuid4

from sqlalchemy import insert

from app.db.models.conversations import WspMessage
from app.db.models.leads import Lead
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


async def test_context_carries_noshows_last_message_time_media_and_ad_origin(tenant):
    """Hasta 2026-11-09 ``contador_noshow`` y ``ultimo_mensaje_at`` no se
    seleccionaban y llegaban vacíos; una foto sin pie llegaba como ``None``."""
    lead_id = str(uuid4())
    now = datetime.now(timezone.utc).replace(microsecond=0)
    with tenant_context(tenant):
        await ensure_lead_stub(lead_id, now - timedelta(hours=3), None)
        async with session_scope() as session:
            await session.execute(Lead.__table__.update().where(Lead.id == lead_id).values(contador_noshow=2))
            await session.execute(insert(WspMessage).values(
                chat_id=lead_id, sender="cliente", content="Me interesa la promoción", sent_at=now - timedelta(hours=3),
                message_type="text", provider_payload={"referral": {"source_type": "ad", "headline": "Limpieza facial", "body": "Agenda tu cita"}},
            ))
            await session.execute(insert(WspMessage).values(
                chat_id=lead_id, sender="cliente", content=None, sent_at=now - timedelta(hours=2), message_type="image",
            ))
            await session.execute(insert(WspMessage).values(
                chat_id=lead_id, sender="cliente", content=None, sent_at=now - timedelta(hours=1), message_type="interactive",
                message_subtype="button_reply", provider_payload={"interactive": {"button_reply": {"id": "si", "title": "Sí, quiero"}}},
            ))
        context = await fetch_analysis_context(lead_id)

    assert context["lead"]["contador_noshow"] == 2
    assert context["lead"]["ultimo_mensaje_at"].startswith((now - timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%S"))
    # Del más nuevo al más viejo.
    texts = [message["content"] for message in context["messages"]]
    assert texts == ["Tocó el botón: Sí, quiero (id si)", "[imagen]", "Me interesa la promoción"]
    assert context["messages"][2]["anuncio"] == "Escribió desde un anuncio: Limpieza facial — Agenda tu cita"
    assert "anuncio" not in context["messages"][0]
