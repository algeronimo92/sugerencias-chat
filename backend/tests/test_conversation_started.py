from unittest.mock import AsyncMock

from app.modules.automations.ports.types import AutomationTrigger
from app.modules.automations.application import triggers
from app.modules.automations.domain.events import AutomationsScheduled
from app.modules.automations.domain.flow_definition import normalize_visual_draft


def test_visual_draft_accepts_conversation_started_trigger():
    normalized = normalize_visual_draft("Bienvenida", {
        "conditions": {},
        "nodes": [
            {
                "id": "trigger",
                "type": "trigger",
                "position": {"x": 0, "y": 0},
                "data": {"trigger_type": "conversation_started"},
            },
            {
                "id": "end",
                "type": "end",
                "position": {"x": 300, "y": 0},
                "data": {"label": "Fin"},
            },
        ],
        "edges": [{
            "id": "trigger-end",
            "source": "trigger",
            "target": "end",
            "source_handle": "next",
        }],
    })

    assert normalized["trigger_type"] == AutomationTrigger.CONVERSATION_STARTED


async def test_inbound_message_opens_and_emits_new_conversation_once(in_memory_automations, monkeypatch):
    opened = AsyncMock(return_value={
        "version": 3,
        "opened_at": "2026-08-05T14:30:00.000000Z",
    })
    monkeypatch.setattr(triggers, "open_conversation_from_inbound", opened)

    await triggers.trigger_inbound_message({
        "chat_id": "lead-1",
        "message_id": "wamid-7",
        "sender": "cliente",
        "content": "Hola de nuevo",
    })

    opened.assert_awaited_once_with("lead-1", "wamid-7", "Hola de nuevo")
    started, received = in_memory_automations.scheduling.scheduled
    assert (started["trigger_type"], started["lead_id"], started["event_key"], started["payload"]) == (
        AutomationTrigger.CONVERSATION_STARTED,
        "lead-1",
        "conversation:lead-1:3",
        {
            "message_id": "wamid-7",
            "content": "Hola de nuevo",
            "message_type": None,
            "message_subtype": None,
            "reply_id": None,
            "conversation_version": 3,
            "conversation_opened_at": "2026-08-05T14:30:00.000000Z",
        },
    )
    assert (received["trigger_type"], received["lead_id"], received["event_key"]) == (
        AutomationTrigger.MESSAGE_RECEIVED,
        "lead-1",
        "message:wamid-7",
    )
    # Cada alta despierta al worker una vez confirmada.
    assert len(in_memory_automations.of(AutomationsScheduled)) == 2
    # El cliente volvió a escribir: cualquier cierre por silencio queda sin efecto.
    assert in_memory_automations.scheduling.cancelled_deadlines == ["lead-1"]


async def test_inbound_message_does_not_repeat_trigger_while_open(in_memory_automations, monkeypatch):
    monkeypatch.setattr(triggers, "open_conversation_from_inbound", AsyncMock(return_value=None))

    await triggers.trigger_inbound_message({
        "chat_id": "lead-1",
        "message_id": "wamid-8",
        "sender": "cliente",
        "content": "Segundo mensaje",
    })

    [received] = in_memory_automations.scheduling.scheduled
    assert received["trigger_type"] == AutomationTrigger.MESSAGE_RECEIVED


async def test_the_first_message_of_a_chat_counts_as_its_creation(in_memory_automations, monkeypatch):
    monkeypatch.setattr(triggers, "open_conversation_from_inbound", AsyncMock(return_value=None))
    in_memory_automations.scheduling.first_message.add("lead-1")

    await triggers.trigger_inbound_message({"chat_id": "lead-1", "message_id": "wamid-1", "sender": "cliente"})

    created = in_memory_automations.scheduling.scheduled[-1]
    assert (created["trigger_type"], created["event_key"], created["payload"]) == (
        AutomationTrigger.LEAD_CREATED, "lead:first-message:wamid-1", {"source": "first_inbound_message"},
    )


async def test_a_seller_message_only_moves_the_silence_deadline(in_memory_automations):
    message = {"chat_id": "lead-1", "message_id": "wamid-9", "sender": "vendedor"}

    await triggers.trigger_inbound_message(message)

    assert in_memory_automations.scheduling.deadline_messages == [(message, None)]
    assert in_memory_automations.scheduling.scheduled == []


# La transición de apertura (versión nueva, auditoría, una sola vez aunque
# lleguen dos webhooks) se prueba en test_lead_commands.py, contra el comando.
