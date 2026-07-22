import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select, update

from db.models import Lead, MessageOutbox, ScheduledMessage, User, WspMessage
from db.session import get_sessionmaker
from services.db_service import CUSTOMER_SERVICE_WINDOW
from services.ws_manager import manager

logger = logging.getLogger(__name__)

POLL_SECONDS = 1.0
CLAIM_LIMIT = 50
DISPATCH_CONCURRENCY = 10
STALE_PROCESSING_MINUTES = 5


def _ts(value: datetime | None) -> str | None:
    return value.strftime("%Y-%m-%dT%H:%M:%S.%fZ") if value else None


def _item(row) -> dict:
    return {
        "id": row["id"],
        "lead_id": row["lead_id"],
        "text": row["text"],
        "scheduled_at": _ts(row["scheduled_at"]),
        "status": row["status"],
        "created_by_user_id": row["created_by_user_id"],
        "created_by_user_name": row["created_by_user_name"],
        "queued_message_id": row["queued_message_id"],
        "error": row["error"],
        "created_at": _ts(row["created_at"]),
    }


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


async def list_scheduled_messages(lead_id: str) -> list[dict]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=1)
    stmt = (
        select(*_columns())
        .join(User, User.id == ScheduledMessage.created_by_user_id)
        .where(
            ScheduledMessage.lead_id == lead_id,
            or_(
                ScheduledMessage.status.in_(("scheduled", "processing", "queued", "failed")),
                (ScheduledMessage.status == "sent") & (ScheduledMessage.scheduled_at >= cutoff),
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
        if not await session.scalar(select(Lead.remote_jid).where(Lead.remote_jid == lead_id)):
            return None
        scheduled = ScheduledMessage(
            lead_id=lead_id,
            text=text,
            scheduled_at=scheduled_at,
            status="scheduled",
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
        if scheduled.status not in ("scheduled", "failed"):
            raise ValueError("El mensaje ya está en proceso de envío y no puede cancelarse")
        scheduled.status = "cancelled"
        scheduled.updated_at = datetime.now(timezone.utc)
        lead_id = scheduled.lead_id
        await session.commit()
    return {"id": scheduled_id, "lead_id": lead_id, "status": "cancelled"}


async def _recover_stale() -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=STALE_PROCESSING_MINUTES)
    async with get_sessionmaker()() as session:
        await session.execute(
            update(ScheduledMessage)
            .where(ScheduledMessage.status == "processing", ScheduledMessage.updated_at < cutoff)
            .values(status="scheduled", updated_at=datetime.now(timezone.utc))
        )
        await session.commit()


async def _claim_due() -> list[int]:
    now = datetime.now(timezone.utc)
    stmt = (
        select(ScheduledMessage)
        .where(
            ScheduledMessage.status == "scheduled",
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
            scheduled.status = "processing"
            scheduled.updated_at = now
            ids.append(scheduled.id)
        if rows:
            await session.commit()
    return ids


async def _dispatch(scheduled_id: int) -> None:
    now = datetime.now(timezone.utc)
    lead_id: str | None = None
    status = "failed"
    async with get_sessionmaker()() as session:
        scheduled = await session.get(ScheduledMessage, scheduled_id, with_for_update=True)
        if scheduled is None or scheduled.status != "processing":
            return
        lead_id = scheduled.lead_id
        last_customer_message = await session.scalar(
            select(func.max(WspMessage.sent_at)).where(
                WspMessage.chat_id == scheduled.lead_id,
                WspMessage.sender == "cliente",
            )
        )
        window_open = bool(
            last_customer_message
            and last_customer_message + CUSTOMER_SERVICE_WINDOW > now
        )
        if not window_open:
            scheduled.status = "failed"
            scheduled.error = (
                "No se envió porque la ventana de atención de 24 horas está cerrada. "
                "Espera un nuevo mensaje del cliente o usa una plantilla oficial."
            )
            scheduled.updated_at = now
            await session.commit()
        else:
            message = WspMessage(
                chat_id=scheduled.lead_id,
                sender="vendedor",
                content=scheduled.text,
                sent_at=now,
                status="PENDING",
            )
            session.add(message)
            await session.flush()
            session.add(MessageOutbox(
                message_id=message.id,
                chat_id=scheduled.lead_id,
                payload={"type": "text", "text": scheduled.text},
                status="pending",
                next_attempt_at=now,
            ))
            scheduled.status = "queued"
            scheduled.queued_message_id = message.id
            scheduled.error = None
            scheduled.updated_at = now
            await session.commit()
            status = "queued"

    if lead_id:
        await manager.broadcast({
            "type": "scheduled_messages_updated",
            "chat_id": lead_id,
            "status": status,
        })
        if status == "queued":
            await manager.broadcast({
                "type": "chats_updated",
                "chat_id": lead_id,
                "reason": "outbound_queued",
            })


async def watch_scheduled_messages() -> None:
    await _recover_stale()
    semaphore = asyncio.Semaphore(DISPATCH_CONCURRENCY)

    async def dispatch_bounded(scheduled_id: int) -> None:
        async with semaphore:
            await _dispatch(scheduled_id)

    while True:
        try:
            ids = await _claim_due()
            if ids:
                await asyncio.gather(*(dispatch_bounded(scheduled_id) for scheduled_id in ids))
                continue
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error processing scheduled messages")
        await asyncio.sleep(POLL_SECONDS)
