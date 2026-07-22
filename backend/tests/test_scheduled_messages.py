from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from models.schemas import ScheduledMessageCreate
from routers import scheduled_messages
from services import scheduled_message_service


@pytest.mark.asyncio
async def test_schedule_route_trims_text_and_broadcasts(monkeypatch):
    future = datetime.now(timezone.utc) + timedelta(hours=1)
    item = {
        "id": 9,
        "lead_id": "51999999999@s.whatsapp.net",
        "text": "¿Pudiste realizar el pago?",
        "scheduled_at": future.isoformat(),
        "status": "scheduled",
        "created_by_user_id": 4,
        "created_by_user_name": "Vendedor",
        "queued_message_id": None,
        "error": None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    create = AsyncMock(return_value=item)
    broadcast = AsyncMock()
    monkeypatch.setattr(scheduled_messages, "create_scheduled_message", create)
    monkeypatch.setattr(scheduled_messages.manager, "broadcast", broadcast)

    result = await scheduled_messages.post_scheduled_message(
        "51999999999@s.whatsapp.net",
        ScheduledMessageCreate(text="  ¿Pudiste realizar el pago?  ", scheduled_at=future),
        SimpleNamespace(id=4, role="seller"),
    )

    assert result == item
    create.assert_awaited_once_with(
        "51999999999@s.whatsapp.net",
        "¿Pudiste realizar el pago?",
        future,
        4,
    )
    broadcast.assert_awaited_once_with({
        "type": "scheduled_messages_updated",
        "chat_id": "51999999999@s.whatsapp.net",
        "status": "scheduled",
    })


@pytest.mark.asyncio
async def test_past_schedule_is_rejected_before_touching_database():
    with pytest.raises(ValueError, match="hora futura"):
        await scheduled_message_service.create_scheduled_message(
            "51999999999@s.whatsapp.net",
            "Mensaje",
            datetime.now(timezone.utc) - timedelta(minutes=1),
            4,
        )


@pytest.mark.asyncio
async def test_schedule_route_maps_invalid_time_to_400(monkeypatch):
    monkeypatch.setattr(
        scheduled_messages,
        "create_scheduled_message",
        AsyncMock(side_effect=ValueError("Elige una hora futura para programar el mensaje")),
    )

    with pytest.raises(HTTPException) as exc:
        await scheduled_messages.post_scheduled_message(
            "51999999999@s.whatsapp.net",
            ScheduledMessageCreate(
                text="Mensaje",
                scheduled_at=datetime.now(timezone.utc) + timedelta(hours=1),
            ),
            SimpleNamespace(id=4, role="seller"),
        )

    assert exc.value.status_code == 400
