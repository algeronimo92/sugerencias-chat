from datetime import datetime, timezone

from sqlalchemy import and_, func, or_, select

from db.models import Lead, WspMessage
from db.session import get_sessionmaker
from services.meta_webhook.projection import reply_identifier
from services.store.common import (
    _fmt_ts,
)


async def fetch_chat_signature() -> str:
    """Firma liviana del estado de los mensajes, usada para detectar mensajes nuevos como respaldo del webhook."""
    stmt = select(func.count(WspMessage.id), func.max(WspMessage.sent_at))
    async with get_sessionmaker()() as session:
        count, last_sent = (await session.execute(stmt)).one()
    return f"{count}:{last_sent.isoformat() if last_sent else ''}"


async def fetch_last_wa_message_id(chat_id: str) -> str | None:
    """wa_message_id del último mensaje de un chat (lo que leía el nodo
    Postgres `ultimo mensaje1` de n8n)."""
    stmt = (
        select(WspMessage.wa_message_id)
        .where(WspMessage.chat_id == chat_id, WspMessage.wa_message_id.isnot(None))
        .order_by(WspMessage.id.desc())
        .limit(1)
    )
    async with get_sessionmaker()() as session:
        return await session.scalar(stmt)


async def fetch_latest_message_cursor() -> tuple[datetime, int] | None:
    """Cursor del último mensaje existente, sin recuperar su contenido.

    El monitor lo toma al iniciar para no volver a disparar automatizaciones por
    todo el historial. A partir de ahí avanza por ``(sent_at, id)``.
    """
    stmt = (
        select(WspMessage.sent_at, WspMessage.id)
        .order_by(WspMessage.sent_at.desc(), WspMessage.id.desc())
        .limit(1)
    )
    async with get_sessionmaker()() as session:
        row = (await session.execute(stmt)).first()
    if row is None:
        return None
    return row.sent_at, int(row.id)


def _message_notification_stmt():
    return select(
        WspMessage.id,
        WspMessage.wa_message_id,
        WspMessage.chat_id,
        WspMessage.sender,
        WspMessage.content,
        WspMessage.message_type,
        WspMessage.message_subtype,
        WspMessage.provider_payload,
        WspMessage.sent_at,
        Lead.nombre,
    ).outerjoin(Lead, Lead.id == WspMessage.chat_id)


def _message_notification_payload(row) -> dict:
    return {
        # Se serializa como texto para que IDs bigint no pierdan precisión en JS.
        "message_id": row["wa_message_id"] or str(row["id"]),
        "chat_id": row["chat_id"],
        "sender": row["sender"],
        "content": row["content"],
        "message_type": row["message_type"],
        "message_subtype": row["message_subtype"],
        # El id que eligió el cliente (botón, lista, botón de plantilla): lo
        # usan las automatizaciones para ramificar por respuesta.
        "reply_id": reply_identifier(row["message_type"], row["provider_payload"]),
        "sent_at": _fmt_ts(row["sent_at"]),
        "name": row["nombre"],
    }


async def fetch_messages_after_cursor(
    cursor: tuple[datetime, int] | None,
    limit: int = 500,
) -> list[tuple[tuple[datetime, int], dict]]:
    """Mensajes posteriores al cursor, en orden estable y sin saltos.

    Devuelve también el cursor de cada fila para que el monitor pueda paginar y
    reanudar aun cuando varios mensajes compartan el mismo ``sent_at``.
    """
    stmt = (
        _message_notification_stmt()
        .order_by(WspMessage.sent_at.asc(), WspMessage.id.asc())
        .limit(limit)
    )
    if cursor is not None:
        cursor_ts, cursor_id = cursor
        stmt = stmt.where(or_(
            WspMessage.sent_at > cursor_ts,
            and_(WspMessage.sent_at == cursor_ts, WspMessage.id > cursor_id),
        ))

    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()

    return [
        ((row["sent_at"], int(row["id"])), _message_notification_payload(row))
        for row in rows
    ]


async def fetch_message_by_wa_id(wa_message_id: str) -> dict | None:
    """Payload de notificación de un mensaje concreto.

    Se busca por el ``wa_message_id`` recién guardado, así dos mensajes que
    entran casi a la vez no se pisan (buscar "el último" podía devolver el del
    otro chat)."""
    stmt = (
        _message_notification_stmt()
        .where(WspMessage.wa_message_id == wa_message_id)
        .order_by(WspMessage.id.desc())
        .limit(1)
    )
    async with get_sessionmaker()() as session:
        row = (await session.execute(stmt)).mappings().first()

    if row is None:
        return None
    return _message_notification_payload(row)
