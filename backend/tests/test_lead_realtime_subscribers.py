"""Avisos de tiempo real de los eventos del lead (después del commit)."""

from unittest.mock import AsyncMock

import pytest

from app.modules.leads import subscribers
from app.modules.leads.domain.events import (
    LeadCreated,
    LeadDeleted,
    LeadNoShowRegistered,
    LeadStageChanged,
    LeadsMerged,
    LeadTagged,
    LeadUpdated,
)
from app.modules.leads.domain.lead import Actor

ACTOR = Actor.user(7)


@pytest.fixture
def broadcast(monkeypatch):
    mock = AsyncMock()
    monkeypatch.setattr(subscribers.manager, "broadcast", mock)
    return mock


def _sent(broadcast) -> list[tuple[str, str]]:
    return [(call.args[0]["chat_id"], call.args[0]["reason"]) for call in broadcast.await_args_list]


@pytest.mark.parametrize("handler,event,reason", [
    (subscribers.lead_created, LeadCreated(lead_id="a", actor=ACTOR, activity_id=1), "lead_created"),
    (subscribers.stage_changed, LeadStageChanged(lead_id="a", actor=ACTOR, old_stage="x", new_stage="y", activity_id=1), "stage_changed"),
    (subscribers.no_show_registered, LeadNoShowRegistered(lead_id="a", actor=ACTOR, count=1), "lead_updated"),
    (subscribers.tag_changed, LeadTagged(lead_id="a", actor=ACTOR, tag_id=1, added=True), "tag_changed"),
    (subscribers.lead_deleted, LeadDeleted(lead_id="a", actor=ACTOR), "lead_deleted"),
    (subscribers.lead_updated, LeadUpdated(lead_id="a", actor=ACTOR, fields=("nombre",), event_type="lead_updated"), "lead_updated"),
    (subscribers.lead_updated, LeadUpdated(lead_id="a", actor=ACTOR, fields=("conversacion_abierta",), event_type="conversation_closed"), "conversation_closed"),
])
async def test_each_event_announces_its_reason(broadcast, handler, event, reason):
    await handler(event)
    assert _sent(broadcast) == [("a", reason)]


async def test_a_merge_updates_the_survivor_and_removes_the_source(broadcast):
    await subscribers.leads_merged(LeadsMerged(lead_id="a", actor=ACTOR, source_id="b"))
    assert _sent(broadcast) == [("a", "lead_updated"), ("b", "lead_deleted")]


async def test_inbox_bookkeeping_is_not_an_edit(broadcast):
    """El mensaje que movió ultimo_mensaje_at ya avisa por su lado."""
    await subscribers.lead_updated(LeadUpdated(
        lead_id="a", actor=ACTOR, fields=("ultimo_emisor", "ultimo_mensaje_at"), event_type="lead_updated",
    ))
    broadcast.assert_not_awaited()
