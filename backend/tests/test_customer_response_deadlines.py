"""Cierre por silencio del cliente: el vencimiento se mueve con cada mensaje
del vendedor, se cancela cuando el cliente contesta y se revalida justo antes
de correr."""

import dataclasses
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

from domain_types import AutomationTrigger
from app.modules.automations.application import triggers
from app.modules.automations.application.engine import _customer_response_deadline_is_current
from app.modules.automations.domain.events import AutomationsChanged
from app.modules.automations.domain.rules import message_sent_at


async def test_seller_message_programs_deadline_without_running_inbound_triggers(in_memory_automations, monkeypatch):
    open_conversation = AsyncMock()
    monkeypatch.setattr(triggers, "open_conversation_from_inbound", open_conversation)
    message = {
        "chat_id": "lead-1",
        "message_id": "seller-10",
        "sender": "vendedor",
        "sent_at": "2026-08-05T18:00:00Z",
    }

    await triggers.trigger_inbound_message(message)

    assert in_memory_automations.scheduling.deadline_messages == [(message, None)]
    open_conversation.assert_not_awaited()
    assert in_memory_automations.scheduling.scheduled == []


async def test_a_moved_deadline_wakes_the_worker(in_memory_automations):
    in_memory_automations.scheduling.schedule_customer_deadlines = AsyncMock(return_value=1)

    await triggers.trigger_inbound_message({"chat_id": "lead-1", "message_id": "seller-10", "sender": "vendedor"})

    assert in_memory_automations.of(AutomationsChanged) == [AutomationsChanged(wake=True)]


async def test_customer_message_cancels_pending_deadline(in_memory_automations, monkeypatch):
    in_memory_automations.scheduling.cancel_customer_deadlines = AsyncMock(return_value=1)
    monkeypatch.setattr(triggers, "open_conversation_from_inbound", AsyncMock(return_value=None))

    await triggers.trigger_inbound_message({
        "chat_id": "lead-1",
        "message_id": "customer-11",
        "sender": "cliente",
        "content": "Sigo aquí",
    })

    assert in_memory_automations.scheduling.cancel_customer_deadlines.await_args.args[0] == "lead-1"
    assert AutomationsChanged() in in_memory_automations.published


async def test_activating_a_rule_backfills_recent_seller_silences(in_memory_automations):
    sent_at = datetime(2026, 8, 5, 18, 0, tzinfo=timezone.utc)
    in_memory_automations.scheduling.silences[4] = [
        {"chat_id": "lead-1", "id": 10, "wa_message_id": None, "sent_at": sent_at},
    ]

    await triggers.backfill_customer_response_deadlines(4)

    assert in_memory_automations.scheduling.deadline_messages == [(
        {"chat_id": "lead-1", "message_id": "10", "sender": "vendedor", "sent_at": sent_at}, 4,
    )]


def _deadline(**overrides):
    return SimpleNamespace(**{
        "trigger_type": AutomationTrigger.CUSTOMER_RESPONSE_OVERDUE,
        "lead_id": "lead-1",
        "event_payload": {"last_message_id": "seller-10"},
        "action_results": [],
        "flow_state": {},
        **overrides,
    })


async def test_deadline_is_stale_when_customer_is_now_last_sender(deps):
    latest = AsyncMock(return_value={"id": 12, "wa_message_id": "customer-12", "sender": "cliente"})

    assert not await _customer_response_deadline_is_current(_deadline(), dataclasses.replace(deps, latest_message=latest))


async def test_deadline_is_current_only_for_same_latest_seller_message(deps):
    latest = AsyncMock(return_value={"id": 10, "wa_message_id": "seller-10", "sender": "vendedor"})

    assert await _customer_response_deadline_is_current(_deadline(), dataclasses.replace(deps, latest_message=latest))


async def test_resumed_visual_flow_is_not_revalidated_as_initial_deadline(deps):
    latest = AsyncMock()
    execution = _deadline(flow_state={"current_node_id": "wait-1", "path": ["trigger", "wait-1"]})

    assert await _customer_response_deadline_is_current(execution, dataclasses.replace(deps, latest_message=latest))
    latest.assert_not_awaited()


def test_message_timestamp_is_normalized_to_utc():
    parsed = message_sent_at("2026-08-05T13:00:00-05:00", fallback=datetime.now(timezone.utc))

    assert parsed == datetime(2026, 8, 5, 18, 0, tzinfo=timezone.utc)
