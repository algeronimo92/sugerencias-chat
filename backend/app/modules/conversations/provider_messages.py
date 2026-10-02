"""Persistencia de lo que Meta informa: mensajes, estados y reacciones.

Los mensajes guardan el objeto de Meta en ``provider_payload`` y sus
proyecciones (texto, medio, cita) en las columnas de siempre. Estados y
reacciones se guardan como eventos en ``whatsapp_message_events``; el
``meta_status`` y el badge ``reactions`` de cada mensaje se recalculan desde
esos eventos, así una entrega repetida o fuera de orden no los deja en un
valor que Meta nunca informó.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db.models.conversations import WhatsAppMessageEvent, WspMessage
from app.db.session import get_sessionmaker
from app.modules.leads.ports.touch import (touch_automated_reply_stmt, touch_last_read_stmt, touch_ultimo_mensaje_stmt)
from app.modules.conversations.message_serialization import serialize_message

# Orden de avance de un envío. ``failed`` es terminal: ningún acuse tardío
# lo pisa. Un estado que no está acá se guarda como evento pero no mueve la
# proyección hasta que el contrato lo conozca.
META_STATUS_RANK = {"sent": 1, "delivered": 2, "read": 3, "failed": 4}


async def insert_provider_message(
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
    human_outbound: bool | None = None,
) -> tuple[dict, bool]:
    """Inserta el mensaje si no existe. Devuelve ``(mensaje, creado)``.

    ``wa_message_id`` es único: un reintento de Meta encuentra la fila ya
    guardada y no la duplica ni la modifica.
    """
    now = datetime.now(timezone.utc)
    stmt = (
        pg_insert(WspMessage)
        .values(
            chat_id=chat_id,
            sender=sender,
            content=content,
            sent_at=sent_at or now,
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
    )
    async with get_sessionmaker()() as session:
        row = (await session.execute(stmt)).scalar_one_or_none()
        created = row is not None
        if created:
            if sender == "vendedor":
                touch = touch_automated_reply_stmt if human_outbound is False else touch_last_read_stmt
                await session.execute(touch(chat_id, now))
            await session.execute(touch_ultimo_mensaje_stmt(chat_id, now))
        else:
            row = (
                await session.execute(select(WspMessage).where(WspMessage.wa_message_id == wa_message_id))
            ).scalar_one()
        await session.commit()
        return serialize_message(row), created


async def set_message_media_url(message_id: int, media_url: str) -> None:
    async with get_sessionmaker()() as session:
        await session.execute(
            update(WspMessage).where(WspMessage.id == message_id).values(media_url=media_url)
        )
        await session.commit()


async def set_message_payload(message_id: int, payload: dict | None) -> None:
    async with get_sessionmaker()() as session:
        await session.execute(
            update(WspMessage).where(WspMessage.id == message_id).values(payload=payload)
        )
        await session.commit()


async def record_status_event(
    status: dict[str, Any],
    *,
    occurred_at: datetime | None,
    webhook_event_id: str | None,
) -> dict | None:
    """Guarda un ``statuses[]`` de Meta y recalcula la proyección del mensaje.

    Devuelve ``{id, chat_id, meta_status}`` si la proyección cambió, o None si
    el evento era un duplicado, el mensaje no es nuestro o no hubo avance.
    """
    wa_message_id = status.get("id")
    value = status.get("status")
    if not isinstance(wa_message_id, str) or not isinstance(value, str):
        return None
    async with get_sessionmaker()() as session:
        message = (
            await session.execute(
                select(WspMessage.id, WspMessage.chat_id).where(WspMessage.wa_message_id == wa_message_id)
            )
        ).first()
        inserted = (
            await session.execute(
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
            )
        ).scalar_one_or_none()
        if inserted is None or message is None:
            await session.commit()
            return None
        projection = await _status_projection(session, wa_message_id)
        if projection is None:
            await session.commit()
            return None
        meta_status, status_payload = projection
        changed = (
            await session.execute(
                update(WspMessage)
                .where(
                    WspMessage.id == message.id,
                    WspMessage.meta_status.is_distinct_from(meta_status),
                )
                .values(meta_status=meta_status, status_payload=status_payload)
                .returning(WspMessage.id)
            )
        ).scalar_one_or_none()
        await session.commit()
    if changed is None:
        return None
    return {"id": message.id, "chat_id": message.chat_id, "meta_status": meta_status}


async def _status_projection(session, wa_message_id: str) -> tuple[str, dict] | None:
    events = (
        await session.execute(
            select(WhatsAppMessageEvent.value, WhatsAppMessageEvent.provider_payload)
            .where(
                WhatsAppMessageEvent.kind == "status",
                WhatsAppMessageEvent.wa_message_id == wa_message_id,
            )
            .order_by(WhatsAppMessageEvent.occurred_at, WhatsAppMessageEvent.id)
        )
    ).all()
    ranked = [(META_STATUS_RANK[value], value, payload) for value, payload in events if value in META_STATUS_RANK]
    if not ranked:
        return None
    _rank, value, payload = max(ranked, key=lambda item: item[0])
    return value, payload


async def record_reaction_event(
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
    """Guarda una reacción como evento. False si ya estaba (reintento)."""
    async with get_sessionmaker()() as session:
        inserted = (
            await session.execute(
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
            )
        ).scalar_one_or_none()
        await session.commit()
    return inserted is not None


async def chat_id_for_wa_message(wa_message_id: str) -> str | None:
    async with get_sessionmaker()() as session:
        return await session.scalar(
            select(WspMessage.chat_id).where(WspMessage.wa_message_id == wa_message_id)
        )
