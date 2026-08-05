from contextlib import asynccontextmanager
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from domain_types import AutomationTrigger
from services import automation_service, db_service


def _sessionmaker(session):
    @asynccontextmanager
    async def session_context():
        yield session

    return lambda: session_context


class _MappingResult:
    def __init__(self, row):
        self._row = row

    def mappings(self):
        return self

    def first(self):
        return self._row


def test_visual_draft_accepts_conversation_started_trigger():
    normalized = automation_service.normalize_visual_draft("Bienvenida", {
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


@pytest.mark.asyncio
async def test_inbound_message_opens_and_emits_new_conversation_once(monkeypatch):
    opened = AsyncMock(return_value={
        "version": 3,
        "opened_at": "2026-08-05T14:30:00.000000Z",
    })
    schedule = AsyncMock(return_value=1)
    session = AsyncMock()
    session.scalar = AsyncMock(side_effect=[2, 9])

    monkeypatch.setattr(automation_service, "open_conversation_from_inbound", opened)
    monkeypatch.setattr(automation_service, "schedule_automation_event", schedule)
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))

    await automation_service.trigger_inbound_message({
        "chat_id": "lead-1",
        "message_id": "wamid-7",
        "sender": "cliente",
        "content": "Hola de nuevo",
    })

    opened.assert_awaited_once_with("lead-1", "wamid-7", "Hola de nuevo")
    assert schedule.await_args_list[0].args == (
        AutomationTrigger.CONVERSATION_STARTED,
        "lead-1",
        "conversation:lead-1:3",
        {
            "message_id": "wamid-7",
            "content": "Hola de nuevo",
            "conversation_version": 3,
            "conversation_opened_at": "2026-08-05T14:30:00.000000Z",
        },
    )
    assert schedule.await_args_list[1].args[0:3] == (
        AutomationTrigger.MESSAGE_RECEIVED,
        "lead-1",
        "message:wamid-7",
    )


@pytest.mark.asyncio
async def test_inbound_message_does_not_repeat_trigger_while_open(monkeypatch):
    monkeypatch.setattr(
        automation_service,
        "open_conversation_from_inbound",
        AsyncMock(return_value=None),
    )
    schedule = AsyncMock(return_value=1)
    monkeypatch.setattr(automation_service, "schedule_automation_event", schedule)
    session = AsyncMock()
    session.scalar = AsyncMock(side_effect=[4, 9])
    monkeypatch.setattr(automation_service, "get_sessionmaker", _sessionmaker(session))

    await automation_service.trigger_inbound_message({
        "chat_id": "lead-1",
        "message_id": "wamid-8",
        "sender": "cliente",
        "content": "Segundo mensaje",
    })

    schedule.assert_awaited_once()
    assert schedule.await_args.args[0] == AutomationTrigger.MESSAGE_RECEIVED


@pytest.mark.asyncio
async def test_open_conversation_transition_returns_version_and_audits(monkeypatch):
    opened_at = datetime(2026, 8, 5, 14, 30, tzinfo=timezone.utc)
    session = AsyncMock()
    session.execute = AsyncMock(side_effect=[
        _MappingResult({"conversacion_version": 2, "conversacion_abierta_at": opened_at}),
        None,
    ])
    monkeypatch.setattr(db_service, "get_sessionmaker", _sessionmaker(session))

    result = await db_service.open_conversation_from_inbound(
        "lead-1", "wamid-9", "Necesito otra cita",
    )

    assert result == {
        "version": 2,
        "opened_at": "2026-08-05T14:30:00.000000Z",
    }
    session.commit.assert_awaited_once()
    session.rollback.assert_not_awaited()


@pytest.mark.asyncio
async def test_open_conversation_transition_is_noop_when_already_open(monkeypatch):
    session = AsyncMock()
    session.execute = AsyncMock(return_value=_MappingResult(None))
    monkeypatch.setattr(db_service, "get_sessionmaker", _sessionmaker(session))

    result = await db_service.open_conversation_from_inbound("lead-1", "wamid-10")

    assert result is None
    session.rollback.assert_awaited_once()
    session.commit.assert_not_awaited()
