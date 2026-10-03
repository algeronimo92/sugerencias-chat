"""Último mensaje del cliente en un chat, para quien necesite congelarlo.

Lo usa la auditoría del cambio de etapa del lead: guarda qué dijo la persona
para ser movida. Corre en la transacción del caso de uso si hay una abierta.
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
