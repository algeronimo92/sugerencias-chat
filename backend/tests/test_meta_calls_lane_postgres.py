"""El carril de llamadas del inbox de Meta contra un PostgreSQL real
(docs/analisis/17-plan-llamadas-whatsapp.md, §4.1)."""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import delete, select, update

from app.db.models.control import WebhookInbox
from app.db.session import control_session
from app.integrations.meta_webhook.inbox import (
    CALLS_LANE,
    MAX_ATTEMPTS,
    MESSAGES_LANE,
    claim_events,
    complete_event,
    inbox_stats,
    purge_processed,
    release_event,
    store_changes,
)
from tests.test_meta_webhook_postgres import real_engine  # noqa: F401
from tests.test_tenant_postgres_integration import pg_dsn  # noqa: F401


def _change(field: str) -> dict:
    """Un ``change`` único: el hash de deduplicación cubre el cuerpo entero."""
    return {
        "object": "whatsapp_business_account", "entry_id": "WABA", "entry_time": None, "field": field,
        "value": {"metadata": {"phone_number_id": f"test-{secrets.token_hex(6)}"}},
    }


@pytest.fixture
async def stored(real_engine):  # noqa: F811
    ids: list[str] = []

    async def store(*fields: str) -> list[str]:
        accepted, _ = await store_changes([_change(field) for field in fields])
        ids.extend(accepted)
        return accepted

    yield store
    async with control_session() as session:
        await session.execute(delete(WebhookInbox).where(WebhookInbox.id.in_(ids)))


async def _status(event_id: str) -> tuple[str, int]:
    async with control_session() as session:
        row = (await session.execute(select(WebhookInbox).where(WebhookInbox.id == event_id))).scalar_one()
        return row.status, row.attempts


async def test_each_lane_takes_only_its_own_events(stored) -> None:
    message_id, call_id = await stored("messages", "calls")

    calls = await claim_events(10, ids=[message_id, call_id], lane=CALLS_LANE)
    messages = await claim_events(10, ids=[message_id, call_id], lane=MESSAGES_LANE)

    assert [event.id for event in calls] == [call_id]
    assert [event.id for event in messages] == [message_id]
    assert calls[0].received_at is not None


async def test_a_failed_call_event_waits_before_the_next_attempt(stored) -> None:
    [call_id] = await stored("calls")
    [event] = await claim_events(1, ids=[call_id], lane=CALLS_LANE)
    await complete_event(event.id, error="ConnectionError")

    # Recién fallado: todavía no.
    assert await claim_events(1, ids=[call_id], lane=CALLS_LANE) == []

    async with control_session() as session:
        await session.execute(
            update(WebhookInbox).where(WebhookInbox.id == call_id)
            .values(updated_at=datetime.now(timezone.utc) - timedelta(seconds=5))
        )
    assert [e.id for e in await claim_events(1, ids=[call_id], lane=CALLS_LANE)] == [call_id]


async def test_a_released_event_is_ready_again_without_spending_an_attempt(stored) -> None:
    [call_id] = await stored("calls")
    await claim_events(1, ids=[call_id], lane=CALLS_LANE)
    assert await _status(call_id) == ("processing", 1)

    await release_event(call_id)

    assert await _status(call_id) == ("received", 0)
    assert [e.id for e in await claim_events(1, ids=[call_id], lane=CALLS_LANE)] == [call_id]


async def test_an_abandoned_call_event_is_taken_back_quickly(stored) -> None:
    [call_id] = await stored("calls")
    await claim_events(1, ids=[call_id], lane=CALLS_LANE)
    async with control_session() as session:
        await session.execute(
            update(WebhookInbox).where(WebhookInbox.id == call_id)
            .values(processing_started_at=datetime.now(timezone.utc) - timedelta(seconds=20))
        )

    assert [e.id for e in await claim_events(1, ids=[call_id], lane=CALLS_LANE)] == [call_id]
    # El de mensajes conserva sus 5 minutos.
    [message_id] = await stored("messages")
    await claim_events(1, ids=[message_id])
    async with control_session() as session:
        await session.execute(
            update(WebhookInbox).where(WebhookInbox.id == message_id)
            .values(processing_started_at=datetime.now(timezone.utc) - timedelta(seconds=20))
        )
    assert await claim_events(1, ids=[message_id]) == []


async def test_exhausted_events_are_purged_after_the_retention(stored) -> None:
    exhausted, recent = await stored("calls", "calls")
    old = datetime.now(timezone.utc) - timedelta(days=8)
    async with control_session() as session:
        await session.execute(
            update(WebhookInbox).where(WebhookInbox.id.in_([exhausted, recent]))
            .values(status="failed", attempts=MAX_ATTEMPTS)
        )
        await session.execute(update(WebhookInbox).where(WebhookInbox.id == exhausted).values(updated_at=old))

    await purge_processed()

    async with control_session() as session:
        left = (await session.execute(select(WebhookInbox.id).where(WebhookInbox.id.in_([exhausted, recent])))).scalars().all()
    assert left == [recent]


async def test_inbox_stats_count_pending_and_lost_events(stored) -> None:
    """Las métricas de la cola de entrada. El inbox es global y otros tests
    escriben en él: se comparan diferencias, no valores absolutos."""
    before = await inbox_stats()
    waiting, retrying, lost = await stored("messages", "messages", "messages")
    async with control_session() as session:
        await session.execute(
            update(WebhookInbox).where(WebhookInbox.id == waiting)
            .values(received_at=datetime.now(timezone.utc) - timedelta(minutes=30))
        )
        await session.execute(update(WebhookInbox).where(WebhookInbox.id == retrying).values(status="failed", attempts=3))
        await session.execute(
            update(WebhookInbox).where(WebhookInbox.id == lost).values(status="failed", attempts=MAX_ATTEMPTS)
        )

    after = await inbox_stats()

    assert after.pending - before.pending == 2
    assert after.exhausted - before.exhausted == 1
    assert after.exhausted_last_hour - before.exhausted_last_hour == 1
    assert after.oldest_pending_age_seconds >= 30 * 60 - 5
