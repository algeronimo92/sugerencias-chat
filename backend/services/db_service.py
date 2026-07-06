from datetime import datetime

from sqlalchemy import func, or_, select, true

from db.models import Lead, WspMessage
from db.session import get_sessionmaker


def _fmt_ts(value: datetime | None) -> str | None:
    return value.strftime('%Y-%m-%dT%H:%M:%SZ') if value else None


def _last_message_subquery():
    """Último mensaje por chat vía LATERAL JOIN, evita un N+1 por lead."""
    return (
        select(WspMessage.content, WspMessage.sent_at)
        .where(WspMessage.chat_id == Lead.remote_jid)
        .order_by(WspMessage.sent_at.desc())
        .limit(1)
        .lateral()
    )


async def fetch_chats(search: str | None = None) -> list[dict]:
    last_message = _last_message_subquery()

    stmt = (
        select(
            Lead.remote_jid.label("chat_id"),
            Lead.telefono.label("phone"),
            Lead.nombre.label("name"),
            Lead.servicio_interes,
            Lead.vendedor,
            Lead.origen,
            Lead.notas,
            last_message.c.content.label("last_message"),
            last_message.c.sent_at.label("timestamp"),
        )
        .join(last_message, true(), isouter=True)
        .order_by(last_message.c.sent_at.desc().nulls_last())
        .limit(100)
    )

    if search:
        pattern = f"%{search}%"
        stmt = stmt.where(
            or_(
                Lead.remote_jid.ilike(pattern),
                Lead.telefono.ilike(pattern),
                Lead.nombre.ilike(pattern),
                last_message.c.content.ilike(pattern),
            )
        )

    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()

    return [
        {
            "chat_id": r["chat_id"],
            "phone": r["phone"],
            "name": r["name"],
            "servicio_interes": r["servicio_interes"],
            "vendedor": r["vendedor"],
            "origen": r["origen"],
            "notas": r["notas"],
            "last_message": r["last_message"],
            "timestamp": _fmt_ts(r["timestamp"]),
        }
        for r in rows
    ]


async def fetch_chat_signature() -> str:
    """Firma liviana del estado de los mensajes, usada para detectar mensajes nuevos como respaldo del webhook."""
    stmt = select(func.count(WspMessage.id), func.max(WspMessage.sent_at))
    async with get_sessionmaker()() as session:
        count, last_sent = (await session.execute(stmt)).one()
    return f"{count}:{last_sent.isoformat() if last_sent else ''}"


async def fetch_messages(chat_id: str) -> list[dict]:
    stmt = (
        select(
            WspMessage.id,
            WspMessage.sender,
            WspMessage.content,
            WspMessage.sent_at,
            WspMessage.media_url,
        )
        .where(WspMessage.chat_id == chat_id)
        .order_by(WspMessage.sent_at.asc())
        .limit(500)
    )

    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()

    return [
        {
            "id": r["id"],
            "sender": r["sender"],
            "content": r["content"],
            "sent_at": _fmt_ts(r["sent_at"]),
            "media_url": r["media_url"],
        }
        for r in rows
    ]
