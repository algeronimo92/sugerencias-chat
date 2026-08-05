from contextlib import asynccontextmanager
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from domain_types import AutomationTrigger
from services import automation_service


def _session_factory(session):
    @asynccontextmanager
    async def context():
        yield session

    return context


class _MappingResult:
    def __init__(self, row):
        self.row = row

    def mappings(self):
        return self

    def first(self):
        return self.row


@pytest.mark.asyncio
async def test_seller_message_programs_deadline_without_running_inbound_triggers(monkeypatch):
    schedule_deadline = AsyncMock(return_value=1)
    open_conversation = AsyncMock()
    schedule_event = AsyncMock()
    monkeypatch.setattr(
        automation_service,
        "_schedule_customer_response_deadlines",
        schedule_deadline,
    )
    monkeypatch.setattr(automation_service, "open_conversation_from_inbound", open_conversation)
    monkeypatch.setattr(automation_service, "schedule_automation_event", schedule_event)

    message = {
        "chat_id": "lead-1",
        "message_id": "seller-10",
        "sender": "vendedor",
        "sent_at": "2026-08-05T18:00:00Z",
    }
    await automation_service.trigger_inbound_message(message)

    schedule_deadline.assert_awaited_once_with(message)
    open_conversation.assert_not_awaited()
    schedule_event.assert_not_awaited()


@pytest.mark.asyncio
async def test_customer_message_cancels_pending_deadline(monkeypatch):
    cancel = AsyncMock(return_value=1)
    monkeypatch.setattr(automation_service, "_cancel_customer_response_deadlines", cancel)
    monkeypatch.setattr(
        automation_service,
        "open_conversation_from_inbound",
        AsyncMock(return_value=None),
    )
    monkeypatch.setattr(automation_service, "schedule_automation_event", AsyncMock(return_value=1))
    monkeypatch.setattr(automation_service.manager, "broadcast", AsyncMock())
    session = AsyncMock()
    session.scalar = AsyncMock(side_effect=[2, 9])
    monkeypatch.setattr(automation_service, "get_sessionmaker", lambda: _session_factory(session))

    await automation_service.trigger_inbound_message({
        "chat_id": "lead-1",
        "message_id": "customer-11",
        "sender": "cliente",
        "content": "Sigo aquí",
    })

    cancel.assert_awaited_once_with("lead-1")
    automation_service.manager.broadcast.assert_awaited_once_with({
        "type": "automations_updated"
    })


@pytest.mark.asyncio
async def test_deadline_is_stale_when_customer_is_now_last_sender():
    session = AsyncMock()
    session.execute = AsyncMock(return_value=_MappingResult({
        "id": 12,
        "wa_message_id": "customer-12",
        "sender": "cliente",
    }))
    deps = SimpleNamespace(session=_session_factory(session))
    execution = SimpleNamespace(
        trigger_type=AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE,
        lead_id="lead-1",
        event_payload={"last_message_id": "seller-10"},
    )

    assert not await automation_service._customer_response_deadline_is_current(execution, deps)


@pytest.mark.asyncio
async def test_deadline_is_current_only_for_same_latest_seller_message():
    session = AsyncMock()
    session.execute = AsyncMock(return_value=_MappingResult({
        "id": 10,
        "wa_message_id": "seller-10",
        "sender": "vendedor",
    }))
    deps = SimpleNamespace(session=_session_factory(session))
    execution = SimpleNamespace(
        trigger_type=AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE,
        lead_id="lead-1",
        event_payload={"last_message_id": "seller-10"},
    )

    assert await automation_service._customer_response_deadline_is_current(execution, deps)


@pytest.mark.asyncio
async def test_resumed_visual_flow_is_not_revalidated_as_initial_deadline():
    session = AsyncMock()
    deps = SimpleNamespace(session=_session_factory(session))
    execution = SimpleNamespace(
        trigger_type=AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE,
        lead_id="lead-1",
        event_payload={"last_message_id": "seller-10"},
        action_results=[],
        flow_state={"current_node_id": "wait-1", "path": ["trigger", "wait-1"]},
    )

    assert await automation_service._customer_response_deadline_is_current(execution, deps)
    session.execute.assert_not_awaited()


def test_message_timestamp_is_normalized_to_utc():
    parsed = automation_service._message_sent_at("2026-08-05T13:00:00-05:00")

    assert parsed == datetime(2026, 8, 5, 18, 0, tzinfo=timezone.utc)
