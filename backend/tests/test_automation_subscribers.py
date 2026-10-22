"""Los avisos del motor salen de sus suscriptores, después del commit."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.modules.automations import subscribers
from app.modules.automations.domain.events import (
    AutomationMessagesQueued,
    AutomationNotificationCreated,
    AutomationsChanged,
    AutomationsScheduled,
    AutomationTaskCreated,
)


@pytest.fixture
def socket(monkeypatch):
    manager = SimpleNamespace(broadcast=AsyncMock(), send_to_user=AsyncMock())
    monkeypatch.setattr(subscribers, "manager", manager)
    woken = []
    monkeypatch.setattr(subscribers.wakeup, "wake", lambda: woken.append(True))
    manager.woken = woken
    return manager


async def test_a_change_refreshes_the_panels_without_waking_the_worker(socket):
    await subscribers.announce_automations_changed(AutomationsChanged())

    socket.broadcast.assert_awaited_once_with({"type": "automations_updated"})
    assert socket.woken == []


async def test_new_work_wakes_the_worker(socket):
    await subscribers.announce_automations_changed(AutomationsScheduled(count=2))

    socket.broadcast.assert_awaited_once_with({"type": "automations_updated"})
    assert socket.woken == [True]


async def test_queued_messages_refresh_the_chat_and_the_dashboard(socket):
    await subscribers.announce_messages_queued(AutomationMessagesQueued(chat_id="lead-1"))

    socket.broadcast.assert_awaited_once_with({"type": "chats_updated", "chat_id": "lead-1", "reason": "outbound_message"})


async def test_a_created_task_refreshes_the_task_lists(socket):
    await subscribers.announce_task_created(AutomationTaskCreated(task_id=3))

    socket.broadcast.assert_awaited_once_with({"type": "tasks_updated"})


async def test_a_notification_reaches_only_its_recipient(socket):
    await subscribers.deliver_notification(AutomationNotificationCreated(user_id=7, notification={"id": 1}))

    socket.send_to_user.assert_awaited_once_with(7, {"type": "notification_created", "notification": {"id": 1}})
    socket.broadcast.assert_not_awaited()
