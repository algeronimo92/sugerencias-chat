from datetime import datetime, timedelta, timezone

from sqlalchemy import func, or_, select, update

from db.models import Lead, WspMessage
from db.session import get_sessionmaker
from services.lead_touch import touch_last_read_stmt
from services.store.common import (
    _fmt_ts,
)


async def mark_chat_read(chat_id: str) -> None:
    async with get_sessionmaker()() as session:
        await session.execute(touch_last_read_stmt(chat_id, datetime.now(timezone.utc)))
        await session.commit()


async def mark_chat_unread(chat_id: str) -> bool:
    """Retrocede la marca de lectura hasta justo antes del último mensaje del
    cliente. Así el chat queda pendiente con un solo mensaje lógico, sin
    alterar los recibos de lectura que ya se enviaron a WhatsApp."""
    latest_stmt = select(func.max(WspMessage.sent_at)).where(
        WspMessage.chat_id == chat_id,
        WspMessage.sender == "cliente",
    )
    async with get_sessionmaker()() as session:
        latest_customer_message_at = await session.scalar(latest_stmt)
        if latest_customer_message_at is None:
            return False
        result = await session.execute(
            update(Lead)
            .where(Lead.id == chat_id)
            .values(last_read_at=latest_customer_message_at - timedelta(microseconds=1))
        )
        await session.commit()
    return result.rowcount > 0


async def record_lead_touch(chat_id: str) -> bool:
    """Registra un toque de seguimiento (recordatorio de cita, cadencia de
    n8n, etc.) que ya salió por WhatsApp — lo llama el cron correspondiente
    justo después de mandar el mensaje. Ver `POST /api/webhooks/lead-touch`.
    """
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        result = await session.execute(
            update(Lead)
            .where(Lead.id == chat_id)
            .values(
                toques_seguimiento=func.coalesce(Lead.toques_seguimiento, 0) + 1,
                fecha_ultimo_toque=now,
                updated_at=now,
            )
        )
        await session.commit()
    return result.rowcount > 0


async def fetch_unread_wa_message_ids(chat_id: str) -> list[str]:
    """IDs de WhatsApp de los mensajes del cliente sin ver en este chat, para
    marcarlos como leídos en Meta. Hay que llamar esto ANTES de
    mark_chat_read: una vez actualizado last_read_at, estos mensajes dejan de
    contar como "sin ver"."""
    stmt = (
        select(WspMessage.wa_message_id)
        .join(Lead, Lead.id == WspMessage.chat_id)
        .where(
            WspMessage.chat_id == chat_id,
            WspMessage.sender == "cliente",
            WspMessage.wa_message_id.is_not(None),
            WspMessage.wa_message_id != "",
            or_(Lead.last_read_at.is_(None), WspMessage.sent_at > Lead.last_read_at),
        )
    )
    async with get_sessionmaker()() as session:
        return list((await session.execute(stmt)).scalars().all())


async def fetch_total_unread_chat_count() -> int:
    """Total de chats con al menos un mensaje de cliente aún no visto."""
    stmt = (
        select(func.count(func.distinct(WspMessage.chat_id)))
        .join(Lead, Lead.id == WspMessage.chat_id)
        .where(
            WspMessage.sender == "cliente",
            or_(Lead.last_read_at.is_(None), WspMessage.sent_at > Lead.last_read_at),
        )
    )
    async with get_sessionmaker()() as session:
        return (await session.execute(stmt)).scalar_one()
