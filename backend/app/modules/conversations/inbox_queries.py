"""Lado de lectura de la bandeja: qué falta ver."""

from sqlalchemy import func, or_, select

from app.db.models.leads import Lead
from app.db.models.conversations import WspMessage
from app.db.uow import session_scope


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
    async with session_scope() as session:
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
    async with session_scope() as session:
        return (await session.execute(stmt)).scalar_one()
