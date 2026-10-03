"""Cierre de tareas al responder y operación masiva desde Tareas."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.modules.tasks import api as tasks
from app.core.events import dispatch_after_commit
from app.modules.conversations.domain.events import MessageSent, ProviderMessageStored
from app.modules.tasks import subscribers as task_subscribers
from app.modules.tasks import repository as task_service
from tests.conftest import patch_session_scope
from app.realtime import ws_manager


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
    patch_session_scope(monkeypatch, task_service, _sessionmaker(session))

    completed = await task_service.complete_reply_tasks("lead-1", 7)

    assert completed == 2
    params = statements[0].compile().params
    assert "lead-1" in params.values()
    assert 7 in params.values()
    assert "pending" in params.values()
    assert "completed" in params.values()
    assert any(value == ["seguimiento", "whatsapp"] for value in params.values())
    session.flush.assert_awaited_once()


async def test_external_reply_targets_the_seller_assigned_to_the_lead(monkeypatch):
    statements = []
    session = AsyncMock()

    async def execute(statement):
        statements.append(statement)
        return SimpleNamespace(rowcount=1)

    session.execute = execute
    patch_session_scope(monkeypatch, task_service, _sessionmaker(session))

    completed = await task_service.complete_assigned_seller_reply_tasks("lead-1")

    assert completed == 1
    sql = str(statements[0].compile())
    params = statements[0].compile().params
    assert "leads.vendedor_id" in sql
    assert "users.role" in sql
    assert "lead-1" in params.values()
    assert "vendedor" in params.values()
    assert any(value == ["seguimiento", "whatsapp"] for value in params.values())
    session.flush.assert_awaited_once()


async def test_successful_human_message_completes_tasks_and_broadcasts(monkeypatch):
    complete = AsyncMock(return_value=2)
    broadcast = AsyncMock()
    monkeypatch.setattr(task_subscribers, "complete_reply_tasks", complete)
    monkeypatch.setattr(task_subscribers.manager, "broadcast", broadcast)

    await task_subscribers.reply_sent_from_the_app(
        MessageSent(chat_id="lead-1", message_id=20, actor_user_id=7),
    )

    complete.assert_awaited_once_with("lead-1", 7)
    broadcast.assert_awaited_once_with({"type": "tasks_updated"})


async def test_automatic_message_does_not_complete_seller_tasks(monkeypatch):
    complete = AsyncMock()
    monkeypatch.setattr(task_subscribers, "complete_reply_tasks", complete)

    await task_subscribers.reply_sent_from_the_app(
        MessageSent(chat_id="lead-1", message_id=20, actor_user_id=None),
    )

    complete.assert_not_awaited()


async def test_task_completion_failure_does_not_fail_an_already_sent_message(monkeypatch):
    """Corre después del commit del envío: un error se registra y no deshace
    nada ni corta a los demás suscriptores."""
    monkeypatch.setattr(task_subscribers, "complete_reply_tasks", AsyncMock(side_effect=RuntimeError("db")))

    await dispatch_after_commit([MessageSent(chat_id="lead-1", message_id=20, actor_user_id=7)])


async def test_a_reply_from_the_phone_completes_the_assigned_sellers_tasks(monkeypatch):
    complete = AsyncMock(return_value=1)
    monkeypatch.setattr(task_subscribers, "complete_assigned_seller_reply_tasks", complete)
    monkeypatch.setattr(task_subscribers.manager, "broadcast", AsyncMock())
    echo = ProviderMessageStored(chat_id="lead-1", message_id=3, wa_message_id="WA-3", inbound=False, conversational=True)
    inbound = ProviderMessageStored(chat_id="lead-1", message_id=4, wa_message_id="WA-4", inbound=True, conversational=True)

    await task_subscribers.reply_sent_from_the_phone(echo)
    await task_subscribers.reply_sent_from_the_phone(inbound)

    complete.assert_awaited_once_with("lead-1")


@pytest.mark.asyncio
async def test_admin_can_complete_current_team_filter(monkeypatch):
    complete = AsyncMock(return_value=4)
    monkeypatch.setattr(tasks, "complete_pending_tasks", complete)
    broadcast = AsyncMock()
    monkeypatch.setattr(ws_manager.manager, "broadcast", broadcast)
    admin = SimpleNamespace(id=1, role="admin")

    result = await tasks.post_complete_all_tasks(
        assigned_user_id=7,
        all_users=False,
        user=admin,
    )

    assert result == {"completed": 4}
    complete.assert_awaited_once_with(1, True, 7, False)
    # El aviso lo registra el comando como TasksChanged (ver
    # test_completing_tasks_announces_it): la ruta ya no emite nada.
    broadcast.assert_not_awaited()


async def test_completing_tasks_announces_it(monkeypatch):
    from app.modules.tasks import service as task_service
    from app.modules.tasks.events import TasksChanged
    from tests.conversation_fakes import _FakeSession
    from app.db import uow

    published = []

    async def record(pending):
        published.extend(pending)

    monkeypatch.setattr(uow, "get_sessionmaker", lambda: _FakeSession)
    monkeypatch.setattr(uow, "dispatch_in_transaction", record)
    monkeypatch.setattr(task_service.repository, "complete_pending_tasks", AsyncMock(side_effect=[3, 0]))

    assert await task_service.complete_pending_tasks(1, True) == 3
    assert await task_service.complete_pending_tasks(1, True) == 0
    assert published == [TasksChanged()]


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
