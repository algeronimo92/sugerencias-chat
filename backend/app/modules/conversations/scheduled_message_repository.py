"""Atomic domain persistence. No HTTP, realtime, or service imports."""
from __future__ import annotations
from datetime import datetime, timedelta, timezone
from sqlalchemy import or_, select, update
from app.db.models.leads import Lead
from app.db.models.conversations import ScheduledMessage
from app.db.models.auth import User
from domain_types import ScheduledMessageStatus
from app.db.session import get_sessionmaker
from collections.abc import Awaitable, Callable
from app.modules.conversations.scheduled_message_policies import (CLAIM_LIMIT, STALE_PROCESSING_MINUTES, _item)


async def prepare_dispatch(scheduled_id: int, now: datetime, check_window: Callable[[str], Awaitable[bool]], closed_detail: str) -> tuple[str, str, bool] | None:
    async with get_sessionmaker()() as session:
        scheduled = await session.get(ScheduledMessage, scheduled_id, with_for_update=True)
        if scheduled is None or scheduled.status != ScheduledMessageStatus.PROCESSING:
            return None
        lead_id, text = scheduled.lead_id, scheduled.text
        window_open = await check_window(lead_id)
        if not window_open:
            scheduled.status = ScheduledMessageStatus.FAILED
            scheduled.error = closed_detail
            scheduled.updated_at = now
            await session.commit()
        return lead_id, text, window_open


async def mark_queued(scheduled_id: int, message_id: int, updated_at: datetime) -> None:
    async with get_sessionmaker()() as session:
        await session.execute(update(ScheduledMessage).where(ScheduledMessage.id == scheduled_id).values(status=ScheduledMessageStatus.QUEUED, queued_message_id=message_id, error=None, updated_at=updated_at))
        await session.commit()

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
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [_item(row) for row in rows]

async def create_scheduled_message(
    lead_id: str,
    text: str,
    scheduled_at: datetime,
    user_id: int,
) -> dict | None:
    now = datetime.now(timezone.utc)
    if scheduled_at.tzinfo is None:
        scheduled_at = scheduled_at.replace(tzinfo=timezone.utc)
    scheduled_at = scheduled_at.astimezone(timezone.utc)
    if scheduled_at <= now + timedelta(seconds=5):
        raise ValueError("Elige una hora futura para programar el mensaje")

    async with get_sessionmaker()() as session:
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
        await session.commit()
        scheduled_id = scheduled.id

    async with get_sessionmaker()() as session:
        row = (await session.execute(
            select(*_columns())
            .join(User, User.id == ScheduledMessage.created_by_user_id)
            .where(ScheduledMessage.id == scheduled_id)
        )).mappings().one()
    return _item(row)

async def cancel_scheduled_message(
    scheduled_id: int,
    user_id: int,
    is_admin: bool,
) -> dict | None:
    async with get_sessionmaker()() as session:
        scheduled = await session.get(ScheduledMessage, scheduled_id, with_for_update=True)
        if scheduled is None:
            return None
        if not is_admin and scheduled.created_by_user_id != user_id:
            raise PermissionError("No puedes cancelar un mensaje programado por otro usuario")
        if scheduled.status not in (ScheduledMessageStatus.SCHEDULED, ScheduledMessageStatus.FAILED):
            raise ValueError("El mensaje ya está en proceso de envío y no puede cancelarse")
        scheduled.status = ScheduledMessageStatus.CANCELLED
        scheduled.updated_at = datetime.now(timezone.utc)
        lead_id = scheduled.lead_id
        await session.commit()
    return {"id": scheduled_id, "lead_id": lead_id, "status": ScheduledMessageStatus.CANCELLED}

async def _recover_stale() -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=STALE_PROCESSING_MINUTES)
    async with get_sessionmaker()() as session:
        await session.execute(
            update(ScheduledMessage)
            .where(ScheduledMessage.status == ScheduledMessageStatus.PROCESSING, ScheduledMessage.updated_at < cutoff)
            .values(status=ScheduledMessageStatus.SCHEDULED, updated_at=datetime.now(timezone.utc))
        )
        await session.commit()

async def _claim_due() -> list[int]:
    now = datetime.now(timezone.utc)
    stmt = (
        select(ScheduledMessage)
        .where(
            ScheduledMessage.status == ScheduledMessageStatus.SCHEDULED,
            ScheduledMessage.scheduled_at <= now,
        )
        .order_by(ScheduledMessage.scheduled_at, ScheduledMessage.id)
        .limit(CLAIM_LIMIT)
        .with_for_update(skip_locked=True)
    )
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).scalars().all()
        ids = []
        for scheduled in rows:
            scheduled.status = ScheduledMessageStatus.PROCESSING
            scheduled.updated_at = now
            ids.append(scheduled.id)
        if rows:
            await session.commit()
    return ids


def _columns():
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
