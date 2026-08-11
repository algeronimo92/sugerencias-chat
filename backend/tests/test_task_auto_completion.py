"""Cierre de tareas al responder y operación masiva desde Tareas."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from routers import tasks
from services import message_outbox, productivity_service


class _SessionContext:
    def __init__(self, session):
        self.session = session

    async def __aenter__(self):
        return self.session

    async def __aexit__(self, *_args):
        return False


def _sessionmaker(session):
    return lambda: (lambda: _SessionContext(session))


async def test_reply_completion_only_targets_sellers_follow_up_tasks(monkeypatch):
    statements = []
    session = AsyncMock()

    async def execute(statement):
        statements.append(statement)
        return SimpleNamespace(rowcount=2)

    session.execute = execute
    monkeypatch.setattr(productivity_service, "get_sessionmaker", _sessionmaker(session))

    completed = await productivity_service.complete_reply_tasks("lead-1", 7)

    assert completed == 2
    params = statements[0].compile().params
    assert "lead-1" in params.values()
    assert 7 in params.values()
    assert "pending" in params.values()
    assert "completed" in params.values()
    assert any(value == ["seguimiento", "whatsapp"] for value in params.values())
    session.commit.assert_awaited_once()


async def test_successful_human_message_completes_tasks_and_broadcasts(monkeypatch):
    session = AsyncMock()
    session.execute = AsyncMock(side_effect=[
        SimpleNamespace(rowcount=1),
        SimpleNamespace(rowcount=1),
        SimpleNamespace(rowcount=0),
    ])
    monkeypatch.setattr(message_outbox, "get_sessionmaker", _sessionmaker(session))
    complete = AsyncMock(return_value=2)
    monkeypatch.setattr(message_outbox, "complete_reply_tasks", complete)
    broadcast = AsyncMock()
    monkeypatch.setattr(message_outbox.manager, "broadcast", broadcast)

    await message_outbox._mark_sent({
        "id": 10,
        "message_id": 20,
        "chat_id": "lead-1",
        "attempts": 0,
        "payload": {"type": "text", "text": "Hola", "_actor_user_id": 7},
    }, {"key": {"id": "WA-1"}})

    complete.assert_awaited_once_with("lead-1", 7)
    assert {"type": "tasks_updated"} in [call.args[0] for call in broadcast.await_args_list]


async def test_automatic_message_does_not_complete_seller_tasks(monkeypatch):
    session = AsyncMock()
    session.execute = AsyncMock(side_effect=[
        SimpleNamespace(rowcount=1),
        SimpleNamespace(rowcount=1),
        SimpleNamespace(rowcount=0),
    ])
    monkeypatch.setattr(message_outbox, "get_sessionmaker", _sessionmaker(session))
    complete = AsyncMock()
    monkeypatch.setattr(message_outbox, "complete_reply_tasks", complete)
    monkeypatch.setattr(message_outbox.manager, "broadcast", AsyncMock())

    await message_outbox._mark_sent({
        "id": 10,
        "message_id": 20,
        "chat_id": "lead-1",
        "attempts": 0,
        "payload": {"type": "text", "text": "Mensaje automático"},
    }, {"key": {"id": "WA-1"}})

    complete.assert_not_awaited()


async def test_task_completion_failure_does_not_fail_an_already_sent_message(monkeypatch):
    session = AsyncMock()
    session.execute = AsyncMock(side_effect=[
        SimpleNamespace(rowcount=1),
        SimpleNamespace(rowcount=1),
        SimpleNamespace(rowcount=0),
    ])
    monkeypatch.setattr(message_outbox, "get_sessionmaker", _sessionmaker(session))
    monkeypatch.setattr(
        message_outbox,
        "complete_reply_tasks",
        AsyncMock(side_effect=RuntimeError("database temporarily unavailable")),
    )
    broadcast = AsyncMock()
    monkeypatch.setattr(message_outbox.manager, "broadcast", broadcast)

    await message_outbox._mark_sent({
        "id": 10,
        "message_id": 20,
        "chat_id": "lead-1",
        "attempts": 0,
        "payload": {"type": "text", "text": "Hola", "_actor_user_id": 7},
    }, {"key": {"id": "WA-1"}})

    assert broadcast.await_args_list[0].args[0]["reason"] == "outbound_message"


async def test_admin_can_complete_current_team_filter(monkeypatch):
    complete = AsyncMock(return_value=4)
    monkeypatch.setattr(tasks, "complete_pending_tasks", complete)
    broadcast = AsyncMock()
    monkeypatch.setattr(tasks.manager, "broadcast", broadcast)
    admin = SimpleNamespace(id=1, role="admin")

    result = await tasks.post_complete_all_tasks(
        assigned_user_id=7,
        all_users=False,
        user=admin,
    )

    assert result == {"completed": 4}
    complete.assert_awaited_once_with(1, True, 7, False)
    broadcast.assert_awaited_once_with({"type": "tasks_updated"})


async def test_seller_cannot_bulk_complete_other_users(monkeypatch):
    monkeypatch.setattr(tasks, "complete_pending_tasks", AsyncMock())
    seller = SimpleNamespace(id=7, role="vendedor")

    with pytest.raises(HTTPException) as error:
        await tasks.post_complete_all_tasks(
            assigned_user_id=8,
            all_users=False,
            user=seller,
        )

    assert error.value.status_code == 403
