"""Estado de la bandeja de un chat, en PostgreSQL.

Son columnas de la fila del lead (``last_read_at``, ``last_automated_reply_at``,
``ultimo_mensaje_at``), pero su dueño es ``conversations``: las mueve cada
mensaje que entra o sale y cada vez que un vendedor abre el chat. Se escriben
en la transacción del mensaje y no a través de ``leads``: no son una edición
comercial del lead ni se auditan. Por eso tampoco se bloquea la fila del lead
con ``SELECT ... FOR UPDATE``: un ``UPDATE`` directo no compite con el touch de
la misma transacción.
"""

from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import func, select, update

from app.db.models.conversations import WspMessage
from app.db.models.leads import Lead
from app.db.uow import current_session


class SqlInboxState:
    async def touch_human_reply(self, chat_id: str, at: datetime) -> None:
        await current_session().execute(update(Lead).where(Lead.id == chat_id).values(last_read_at=at))

    async def touch_automated_reply(self, chat_id: str, at: datetime) -> None:
        await current_session().execute(
            update(Lead).where(Lead.id == chat_id).values(last_automated_reply_at=at)
        )

    async def touch_last_message(self, chat_id: str, at: datetime) -> None:
        await current_session().execute(update(Lead).where(Lead.id == chat_id).values(ultimo_mensaje_at=at))

    async def mark_read(self, chat_id: str, at: datetime) -> None:
        await self.touch_human_reply(chat_id, at)

    async def mark_unread(self, chat_id: str) -> bool:
        session = current_session()
        latest_customer_message_at = await session.scalar(
            select(func.max(WspMessage.sent_at)).where(
                WspMessage.chat_id == chat_id, WspMessage.sender == "cliente",
            )
        )
        if latest_customer_message_at is None:
            return False
        # Justo antes del último mensaje del cliente: el chat queda pendiente
        # con un solo mensaje lógico.
        result = await session.execute(
            update(Lead)
            .where(Lead.id == chat_id)
            .values(last_read_at=latest_customer_message_at - timedelta(microseconds=1))
        )
        return result.rowcount > 0
