"""Persistencia de los mensajes programados en PostgreSQL."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from app.db.models.auth import User
from app.db.models.conversations import ScheduledMessage
from app.db.models.leads import Lead
from app.db.uow import current_session, session_scope
from app.modules.conversations.scheduled_message_policies import CLAIM_LIMIT, STALE_PROCESSING_MINUTES, _item
from domain_types import ScheduledMessageStatus


def scheduled_columns():
    return (
        ScheduledMessage.id,
        ScheduledMessage.lead_id,
        ScheduledMessage.text,
        ScheduledMessage.scheduled_at,
        ScheduledMessage.status,
        ScheduledMessage.created_by_user_id,
        User.name.label("created_by_user_name"),
        ScheduledMessage.queued_message_id,
        ScheduledMessage.error,
        ScheduledMessage.created_at,
    )


class SqlScheduledStore:
    async def create(self, lead_id: str, text: str, scheduled_at: datetime, user_id: int) -> dict | None:
        session = current_session()
        if not await session.scalar(select(Lead.id).where(Lead.id == lead_id)):
            return None
        scheduled = ScheduledMessage(
            lead_id=lead_id,
            text=text,
            scheduled_at=scheduled_at,
            status=ScheduledMessageStatus.SCHEDULED,
            created_by_user_id=user_id,
        )
        session.add(scheduled)
        await session.flush()
        row = (await session.execute(
            select(*scheduled_columns())
            .join(User, User.id == ScheduledMessage.created_by_user_id)
            .where(ScheduledMessage.id == scheduled.id)
        )).mappings().one()
        return _item(row)

    async def lock(self, scheduled_id: int) -> dict | None:
        scheduled = await current_session().get(ScheduledMessage, scheduled_id, with_for_update=True)
        if scheduled is None:
            return None
        return {
            "id": scheduled.id,
            "lead_id": scheduled.lead_id,
            "text": scheduled.text,
            "status": scheduled.status,
            "created_by_user_id": scheduled.created_by_user_id,
        }

    async def cancel(self, scheduled_id: int, now: datetime) -> None:
        await current_session().execute(
            update(ScheduledMessage)
            .where(ScheduledMessage.id == scheduled_id)
            .values(status=ScheduledMessageStatus.CANCELLED, updated_at=now)
        )

    async def lock_for_dispatch(self, scheduled_id: int) -> dict | None:
        scheduled = await self.lock(scheduled_id)
        if scheduled is None or scheduled["status"] != ScheduledMessageStatus.PROCESSING:
            return None
        return scheduled

    async def fail(self, scheduled_id: int, error: str, now: datetime) -> None:
        await current_session().execute(
            update(ScheduledMessage)
            .where(ScheduledMessage.id == scheduled_id)
            .values(status=ScheduledMessageStatus.FAILED, error=error, updated_at=now)
        )

    async def mark_queued(self, scheduled_id: int, message_id: int, now: datetime) -> None:
        await current_session().execute(
            update(ScheduledMessage)
            .where(ScheduledMessage.id == scheduled_id)
            .values(status=ScheduledMessageStatus.QUEUED, queued_message_id=message_id, error=None, updated_at=now)
        )

    async def recover_stale(self) -> None:
        """Devuelve a la cola los que quedaron en ``processing`` porque el
        proceso murió a mitad de camino."""
        now = datetime.now(timezone.utc)
        async with session_scope() as session:
            await session.execute(
                update(ScheduledMessage)
                .where(
                    ScheduledMessage.status == ScheduledMessageStatus.PROCESSING,
                    ScheduledMessage.updated_at < now - timedelta(minutes=STALE_PROCESSING_MINUTES),
                )
                .values(status=ScheduledMessageStatus.SCHEDULED, updated_at=now)
            )

    async def claim_due(self) -> list[int]:
        now = datetime.now(timezone.utc)
        async with session_scope() as session:
            rows = (await session.execute(
                select(ScheduledMessage)
                .where(
                    ScheduledMessage.status == ScheduledMessageStatus.SCHEDULED,
                    ScheduledMessage.scheduled_at <= now,
                )
                .order_by(ScheduledMessage.scheduled_at, ScheduledMessage.id)
                .limit(CLAIM_LIMIT)
                .with_for_update(skip_locked=True)
            )).scalars().all()
            for scheduled in rows:
                scheduled.status = ScheduledMessageStatus.PROCESSING
                scheduled.updated_at = now
            return [scheduled.id for scheduled in rows]
