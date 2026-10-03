"""Despacho de un mensaje programado que llegó a su hora."""

import pytest

from app.modules.conversations.application.scheduling import dispatch_scheduled_message
from app.modules.conversations.domain.events import OutboundQueued, ScheduledMessageChanged
from domain_types import ScheduledMessageStatus

CHAT_ID = "4316bc30-f78c-57a2-8f98-bff9087678d6"


@pytest.fixture
def entorno(in_memory_conversations):
    in_memory_conversations.scheduled.rows[5] = {
        "id": 5, "lead_id": CHAT_ID, "text": "Hola, ¿seguimos?",
        "status": ScheduledMessageStatus.PROCESSING, "created_by_user_id": 9,
    }
    return in_memory_conversations


def _row(world):
    return world.scheduled.rows[5]


async def test_it_queues_through_the_outbox_door_instead_of_writing_it_itself(entorno):
    await dispatch_scheduled_message(5)

    [queued] = entorno.outbox.queued
    assert (queued["chat_id"], queued["content"]) == (CHAT_ID, "Hola, ¿seguimos?")
    assert entorno.of(OutboundQueued)[0].message_ids == (queued["id"],)


async def test_the_dedupe_key_is_derived_from_the_scheduled_row(entorno):
    """Estable entre reintentos: un segundo despacho devuelve el mismo mensaje."""
    await dispatch_scheduled_message(5)
    _row(entorno)["status"] = ScheduledMessageStatus.PROCESSING

    await dispatch_scheduled_message(5)

    assert len(entorno.outbox.queued) == 1
    assert "scheduled:5" in entorno.outbox.by_key


async def test_it_does_not_claim_a_human_saw_the_chat(entorno):
    """Sin actor: nadie está mirando la app cuando sale un programado, así que
    cuenta como atendido por bot."""
    await dispatch_scheduled_message(5)

    assert entorno.outbox.queued[0]["job"]["actor_user_id"] is None
    assert entorno.inbox.touches == [("bot", CHAT_ID)]


async def test_the_row_keeps_the_id_of_the_message_that_was_queued(entorno):
    await dispatch_scheduled_message(5)

    assert _row(entorno)["status"] == ScheduledMessageStatus.QUEUED
    assert _row(entorno)["queued_message_id"] == entorno.outbox.queued[0]["id"]
    assert [event.status for event in entorno.of(ScheduledMessageChanged)] == [ScheduledMessageStatus.QUEUED]


async def test_a_closed_window_fails_without_queueing_anything(entorno):
    entorno.windows[CHAT_ID] = False

    await dispatch_scheduled_message(5)

    assert entorno.outbox.queued == []
    assert _row(entorno)["status"] == ScheduledMessageStatus.FAILED
    assert "24 horas" in _row(entorno)["error"]
    assert [event.status for event in entorno.of(ScheduledMessageChanged)] == [ScheduledMessageStatus.FAILED]


@pytest.mark.parametrize("estado", [
    ScheduledMessageStatus.SCHEDULED, ScheduledMessageStatus.QUEUED, ScheduledMessageStatus.CANCELLED,
])
async def test_only_a_row_this_worker_claimed_is_dispatched(entorno, estado):
    _row(entorno)["status"] = estado

    await dispatch_scheduled_message(5)

    assert entorno.outbox.queued == []


async def test_a_row_that_disappeared_is_not_dispatched(entorno):
    entorno.scheduled.rows.pop(5)

    await dispatch_scheduled_message(5)

    assert entorno.outbox.queued == []
