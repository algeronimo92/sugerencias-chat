"""Lado de lectura de los mensajes programados."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select

from app.db.models.auth import User
from app.db.models.conversations import ScheduledMessage
from app.modules.conversations.infrastructure.sql_scheduled import scheduled_columns as _columns
from app.modules.conversations.scheduled_message_policies import _item
from app.modules.conversations.domain.types import ScheduledMessageStatus
from app.db.uow import session_scope


async def list_scheduled_messages(lead_id: str) -> list[dict]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=1)
    stmt = (
        select(*_columns())
        .join(User, User.id == ScheduledMessage.created_by_user_id)
        .where(
            ScheduledMessage.lead_id == lead_id,
            or_(
                ScheduledMessage.status.in_((ScheduledMessageStatus.SCHEDULED, ScheduledMessageStatus.PROCESSING, ScheduledMessageStatus.QUEUED, ScheduledMessageStatus.FAILED)),
                (ScheduledMessage.status == ScheduledMessageStatus.SENT) & (ScheduledMessage.scheduled_at >= cutoff),
            ),
        )
        .order_by(ScheduledMessage.scheduled_at.asc(), ScheduledMessage.id.asc())
        .limit(20)
    )
    async with session_scope() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [_item(row) for row in rows]
