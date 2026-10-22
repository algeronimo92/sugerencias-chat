"""Los últimos mensajes de un chat, para quien necesite mirarlos.

Lo usa la auditoría del cambio de etapa del lead (qué dijo la persona para ser
movida) y el motor de automatizaciones (si el chat cambió antes de un
vencimiento, qué adjunto vigilar). Corre en la transacción del caso de uso si
hay una abierta.
"""

from __future__ import annotations

from sqlalchemy import select

from app.db.models.conversations import WspMessage
from app.db.uow import session_scope


async def latest_customer_message(chat_id: str) -> dict | None:
    async with session_scope() as session:
        row = (
            await session.execute(
                select(WspMessage.id, WspMessage.content, WspMessage.sent_at)
                .where(WspMessage.chat_id == chat_id, WspMessage.sender == "cliente")
                .order_by(WspMessage.sent_at.desc(), WspMessage.id.desc())
                .limit(1)
            )
        ).mappings().first()
    return dict(row) if row is not None else None


async def latest_message(chat_id: str) -> dict | None:
    """El último mensaje del chat, de cualquiera de los dos lados."""
    async with session_scope() as session:
        row = (
            await session.execute(
                select(WspMessage.id, WspMessage.wa_message_id, WspMessage.sender)
                .where(WspMessage.chat_id == chat_id)
                .order_by(WspMessage.sent_at.desc(), WspMessage.id.desc())
                .limit(1)
            )
        ).mappings().first()
    return dict(row) if row is not None else None


async def latest_outbound_media_wa_id(chat_id: str) -> str | None:
    """El wa_message_id de la última imagen, video o audio que el vendedor le
    mandó al lead, o None si todavía no le mandó ninguno."""
    async with session_scope() as session:
        return await session.scalar(
            select(WspMessage.wa_message_id).where(
                WspMessage.chat_id == chat_id,
                WspMessage.sender == "vendedor",
                WspMessage.message_type.in_(["image", "video", "audio"]),
                WspMessage.wa_message_id.isnot(None),
            ).order_by(WspMessage.sent_at.desc(), WspMessage.id.desc()).limit(1)
        )
