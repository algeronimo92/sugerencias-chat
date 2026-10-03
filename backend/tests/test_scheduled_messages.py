"""Programar y cancelar mensajes desde la API."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.core.errors import NotFound
from app.modules.conversations import scheduled_messages_api as scheduled_messages
from app.modules.conversations.domain.events import ScheduledMessageChanged
from app.modules.conversations.domain.scheduling import (
    AlreadyDispatching,
    CannotCancelOthersMessage,
    ScheduleInThePast,
)
from app.modules.conversations.schemas import ScheduledMessageCreate
from domain_types import ScheduledMessageStatus

LEAD_ID = "1fbbc88a-3cd3-5ae2-9b58-9772fc53bab6"
SELLER = SimpleNamespace(id=4, role="seller")


async def test_schedule_route_trims_text_and_announces_it(in_memory_conversations):
    future = datetime.now(timezone.utc) + timedelta(hours=1)

    result = await scheduled_messages.post_scheduled_message(
        LEAD_ID, ScheduledMessageCreate(text="  ¿Pudiste realizar el pago?  ", scheduled_at=future), SELLER,
    )

    assert result["text"] == "¿Pudiste realizar el pago?"
    assert result["created_by_user_id"] == 4
    [event] = in_memory_conversations.of(ScheduledMessageChanged)
    assert (event.chat_id, event.status) == (LEAD_ID, ScheduledMessageStatus.SCHEDULED)


async def test_a_past_time_is_rejected_before_touching_the_database(in_memory_conversations):
    with pytest.raises(ScheduleInThePast) as exc:
        await scheduled_messages.post_scheduled_message(
            LEAD_ID,
            ScheduledMessageCreate(text="Mensaje", scheduled_at=datetime.now(timezone.utc) - timedelta(minutes=1)),
            SELLER,
        )

    assert exc.value.status_code == 400
    assert "hora futura" in exc.value.detail
    assert in_memory_conversations.scheduled.created == []


async def test_only_its_author_or_an_admin_can_cancel(in_memory_conversations):
    in_memory_conversations.scheduled.rows[3] = {
        "id": 3, "lead_id": LEAD_ID, "text": "x", "status": ScheduledMessageStatus.SCHEDULED,
        "created_by_user_id": 99,
    }

    with pytest.raises(CannotCancelOthersMessage) as exc:
        await scheduled_messages.delete_scheduled_message(3, SELLER)
    assert exc.value.status_code == 403

    result = await scheduled_messages.delete_scheduled_message(3, SimpleNamespace(id=1, role="admin"))
    assert result == {"status": "cancelled"}
    assert in_memory_conversations.scheduled.rows[3]["status"] == ScheduledMessageStatus.CANCELLED


async def test_a_message_already_on_its_way_cannot_be_cancelled(in_memory_conversations):
    in_memory_conversations.scheduled.rows[3] = {
        "id": 3, "lead_id": LEAD_ID, "text": "x", "status": ScheduledMessageStatus.QUEUED,
        "created_by_user_id": 4,
    }

    with pytest.raises(AlreadyDispatching) as exc:
        await scheduled_messages.delete_scheduled_message(3, SELLER)
    assert exc.value.status_code == 409


async def test_cancelling_a_missing_message_is_404(in_memory_conversations):
    with pytest.raises(NotFound) as exc:
        await scheduled_messages.delete_scheduled_message(404, SELLER)
    assert exc.value.detail == "Mensaje programado no encontrado"
