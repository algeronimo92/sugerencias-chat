import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select, update

from db.models import Lead, ScheduledMessage, User
from domain_types import ScheduledMessageStatus
from db.session import get_sessionmaker
from services.ws_manager import manager
from services.time_format import iso_utc_micros
from services.service_window import SERVICE_WINDOW_CLOSED_DETAIL, service_window_is_open
from services.message_outbox import enqueue_text_message

logger = logging.getLogger(__name__)

POLL_SECONDS = 1.0
CLAIM_LIMIT = 50
DISPATCH_CONCURRENCY = 10
STALE_PROCESSING_MINUTES = 5


def _item(row) -> dict:
    return {
        "id": row["id"],
        "lead_id": row["lead_id"],
        "text": row["text"],
        "scheduled_at": iso_utc_micros(row["scheduled_at"]),
        "status": row["status"],
        "created_by_user_id": row["created_by_user_id"],
        "created_by_user_name": row["created_by_user_name"],
        "queued_message_id": row["queued_message_id"],
        "error": row["error"],
        "created_at": iso_utc_micros(row["created_at"]),
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


async def _dispatch(scheduled_id: int) -> None:
    """Encola el mensaje programado por la misma puerta que el resto.

    El encolado va fuera de la transacción que marca la fila como QUEUED, así
    que hay una ventana entre ambos. La hace segura el `dedupe_key`: si el
    proceso se cae en el medio, `_recover_stale` devuelve la fila a scheduled,
    el próximo intento vuelve a encolar con la misma clave y `enqueue_messages`
    devuelve el mensaje que ya existe en vez de crear otro.
    """
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        scheduled = await session.get(ScheduledMessage, scheduled_id, with_for_update=True)
        if scheduled is None or scheduled.status != ScheduledMessageStatus.PROCESSING:
            return
        lead_id, text = scheduled.lead_id, scheduled.text
        window_open = await service_window_is_open(lead_id)
        if not window_open:
            scheduled.status = ScheduledMessageStatus.FAILED
            scheduled.error = SERVICE_WINDOW_CLOSED_DETAIL
            scheduled.updated_at = now
            await session.commit()

    status = ScheduledMessageStatus.FAILED
    if window_open:
        # Sin actor_user_id: no hay un vendedor mirando la app en este momento,
        # así que cuenta como "atendido por bot" y no como que un humano vio la
        # conversación (enqueue_messages resuelve el touch con ese criterio).
        message = await enqueue_text_message(
            lead_id, text, dedupe_key=f"scheduled:{scheduled_id}",
        )
        async with get_sessionmaker()() as session:
            await session.execute(
                update(ScheduledMessage)
                .where(ScheduledMessage.id == scheduled_id)
                .values(
                    status=ScheduledMessageStatus.QUEUED,
                    queued_message_id=message["id"],
                    error=None,
                    updated_at=datetime.now(timezone.utc),
                )
            )
            await session.commit()
        status = ScheduledMessageStatus.QUEUED

    if lead_id:
        await manager.broadcast({
            "type": "scheduled_messages_updated",
            "chat_id": lead_id,
            "status": status,
        })
        if status == ScheduledMessageStatus.QUEUED:
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
            logger.exception("Error al procesar mensajes programados")
        await asyncio.sleep(POLL_SECONDS)
