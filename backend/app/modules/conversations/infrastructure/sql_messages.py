"""Persistencia de los mensajes en PostgreSQL: lo que informa Meta, reacciones,
adjuntos y fijados.

Los mensajes guardan el objeto de Meta en ``provider_payload`` y sus
proyecciones (texto, medio, cita) en las columnas de siempre. Estados y
reacciones se guardan como eventos en ``whatsapp_message_events``; el
``meta_status`` y el badge ``reactions`` de cada mensaje se recalculan desde
esos eventos, así una entrega repetida o fuera de orden no los deja en un valor
que Meta nunca informó.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db.models.conversations import WhatsAppMessageEvent, WspMessage
from app.db.uow import current_session
from app.modules.conversations.domain.delivery import strongest_meta_status
from app.modules.conversations.domain.errors import PinLimitReached
from app.modules.conversations.domain.reactions import MAX_PINNED_MESSAGES, merge_reactions
from app.modules.conversations.message_serialization import serialize_message


async def _message(chat_id: str, message_id: int) -> WspMessage | None:
    return (await current_session().execute(
        select(WspMessage).where(WspMessage.id == message_id, WspMessage.chat_id == chat_id)
    )).scalar_one_or_none()


class SqlMessageStore:
    async def insert_provider_message(
        self,
        *,
        chat_id: str,
        sender: str,
        wa_message_id: str,
        message_type: str | None,
        message_subtype: str | None,
        provider_payload: dict,
        content: str | None,
        sent_at: datetime | None,
        quoted_wa_message_id: str | None,
        webhook_event_id: str | None,
        payload: dict | None = None,
    ) -> tuple[dict, bool]:
        session = current_session()
        row = (await session.execute(
            pg_insert(WspMessage)
            .values(
                chat_id=chat_id,
                sender=sender,
                content=content,
                sent_at=sent_at or datetime.now(timezone.utc),
                wa_message_id=wa_message_id,
                message_type=message_type,
                message_subtype=message_subtype,
                provider_payload=provider_payload,
                webhook_event_id=webhook_event_id,
                quoted_wa_message_id=quoted_wa_message_id,
                payload=payload,
            )
            .on_conflict_do_nothing(
                index_elements=[WspMessage.wa_message_id],
                index_where=WspMessage.wa_message_id.isnot(None),
            )
            .returning(WspMessage)
        )).scalar_one_or_none()
        created = row is not None
        if not created:
            row = (await session.execute(
                select(WspMessage).where(WspMessage.wa_message_id == wa_message_id)
            )).scalar_one()
        return serialize_message(row), created

    async def set_media_url(self, message_id: int, media_url: str) -> None:
        await current_session().execute(
            update(WspMessage).where(WspMessage.id == message_id).values(media_url=media_url)
        )

    async def set_payload(self, message_id: int, payload: dict | None) -> None:
        await current_session().execute(
            update(WspMessage).where(WspMessage.id == message_id).values(payload=payload)
        )

    async def record_status_event(
        self, status: dict, *, occurred_at: datetime | None, webhook_event_id: str | None,
    ) -> dict | None:
        """Devuelve ``{id, chat_id, meta_status}`` si la proyección cambió; None
        si el evento era un duplicado, el mensaje no es nuestro o no avanzó."""
        wa_message_id = status.get("id")
        value = status.get("status")
        if not isinstance(wa_message_id, str) or not isinstance(value, str):
            return None
        session = current_session()
        message = (await session.execute(
            select(WspMessage.id, WspMessage.chat_id).where(WspMessage.wa_message_id == wa_message_id)
        )).first()
        inserted = (await session.execute(
            pg_insert(WhatsAppMessageEvent)
            .values(
                kind="status",
                wa_message_id=wa_message_id,
                chat_id=message.chat_id if message else None,
                value=value,
                occurred_at=occurred_at,
                provider_payload=status,
                webhook_event_id=webhook_event_id,
            )
            .on_conflict_do_nothing(
                index_elements=["wa_message_id", "value", "occurred_at"],
                index_where=WhatsAppMessageEvent.kind == "status",
            )
            .returning(WhatsAppMessageEvent.id)
        )).scalar_one_or_none()
        if inserted is None or message is None:
            return None
        events = (await session.execute(
            select(WhatsAppMessageEvent.value, WhatsAppMessageEvent.provider_payload)
            .where(WhatsAppMessageEvent.kind == "status", WhatsAppMessageEvent.wa_message_id == wa_message_id)
            .order_by(WhatsAppMessageEvent.occurred_at, WhatsAppMessageEvent.id)
        )).all()
        projection = strongest_meta_status([(value, payload) for value, payload in events])
        if projection is None:
            return None
        meta_status, status_payload = projection
        changed = (await session.execute(
            update(WspMessage)
            .where(WspMessage.id == message.id, WspMessage.meta_status.is_distinct_from(meta_status))
            .values(meta_status=meta_status, status_payload=status_payload)
            .returning(WspMessage.id)
        )).scalar_one_or_none()
        if changed is None:
            return None
        return {"id": message.id, "chat_id": message.chat_id, "meta_status": meta_status}

    async def record_reaction_event(
        self,
        *,
        event_wa_id: str | None,
        target_wa_message_id: str,
        chat_id: str | None,
        emoji: str | None,
        actor: str,
        provider_payload: dict,
        occurred_at: datetime | None,
        webhook_event_id: str | None,
    ) -> bool:
        inserted = (await current_session().execute(
            pg_insert(WhatsAppMessageEvent)
            .values(
                kind="reaction",
                wa_message_id=target_wa_message_id,
                chat_id=chat_id,
                value=emoji or None,
                actor=actor,
                event_wa_id=event_wa_id,
                occurred_at=occurred_at,
                provider_payload=provider_payload,
                webhook_event_id=webhook_event_id,
            )
            .on_conflict_do_nothing(
                index_elements=["event_wa_id"],
                index_where=WhatsAppMessageEvent.event_wa_id.isnot(None),
            )
            .returning(WhatsAppMessageEvent.id)
        )).scalar_one_or_none()
        return inserted is not None

    async def apply_reaction(
        self, chat_id: str, target_wa_message_id: str, emoji: str, *, from_me: bool,
    ) -> dict | None:
        """El mensaje objetivo con su badge actualizado, o None si no está en
        la base (p. ej. una reacción a un mensaje anterior a la integración)."""
        row = (await current_session().execute(
            select(WspMessage).where(
                WspMessage.chat_id == chat_id, WspMessage.wa_message_id == target_wa_message_id,
            )
        )).scalar_one_or_none()
        if row is None:
            return None
        row.reactions = merge_reactions(row.reactions, emoji, from_me=from_me)
        await current_session().flush()
        return serialize_message(row)

    async def pin(self, chat_id: str, message_id: int, user_id: int, at: datetime) -> dict | None:
        row = await _message(chat_id, message_id)
        if row is None or row.deleted_at is not None:
            return None
        if row.pinned_at is None:
            pinned = await current_session().scalar(
                select(func.count()).where(WspMessage.chat_id == chat_id, WspMessage.pinned_at.isnot(None))
            )
            if pinned >= MAX_PINNED_MESSAGES:
                raise PinLimitReached()
            row.pinned_at = at
            row.pinned_by_user_id = user_id
            await current_session().flush()
        return serialize_message(row)

    async def unpin(self, chat_id: str, message_id: int) -> dict | None:
        row = await _message(chat_id, message_id)
        if row is None:
            return None
        if row.pinned_at is not None:
            row.pinned_at = None
            row.pinned_by_user_id = None
            await current_session().flush()
        return serialize_message(row)
