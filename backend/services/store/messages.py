from datetime import datetime, timezone

from sqlalchemy import and_, case, func, insert, or_, select, update
from sqlalchemy.exc import IntegrityError

from db.models import Lead, WspMessage
from db.session import get_sessionmaker
from services.lead_touch import (
    touch_automated_reply_stmt,
    touch_last_read_stmt,
    touch_ultimo_mensaje_stmt,
)
from services.store.common import (
    _fmt_ts,
)

_INSERT_MESSAGE_COLUMNS = (
    WspMessage.id,
    WspMessage.sender,
    WspMessage.content,
    WspMessage.sent_at,
    WspMessage.media_url,
    WspMessage.wa_message_id,
    WspMessage.status,
    WspMessage.message_type,
    WspMessage.analysis,
    WspMessage.payload,
    WspMessage.quoted_wa_message_id,
    WspMessage.media_width,
    WspMessage.media_height,
)


async def insert_message(
    chat_id: str,
    sender: str,
    content: str | None,
    media_url: str | None = None,
    wa_message_id: str | None = None,
    status: str | None = None,
    message_type: str | None = None,
    analysis: dict | None = None,
    payload: dict | None = None,
    human_outbound: bool | None = None,
    message_secret: bytes | None = None,
    sent_at: datetime | None = None,
    quoted_wa_message_id: str | None = None,
    media_width: int | None = None,
    media_height: int | None = None,
) -> dict:
    now = datetime.now(timezone.utc)
    stmt = (
        insert(WspMessage)
        .values(
            chat_id=chat_id,
            sender=sender,
            content=content,
            media_url=media_url,
            sent_at=sent_at or datetime.now(timezone.utc),
            wa_message_id=wa_message_id,
            status=status,
            message_type=message_type,
            analysis=analysis,
            payload=payload,
            message_secret=message_secret,
            quoted_wa_message_id=quoted_wa_message_id,
            media_width=media_width,
            media_height=media_height,
        )
        .returning(*_INSERT_MESSAGE_COLUMNS)
    )
    async with get_sessionmaker()() as session:
        try:
            row = (await session.execute(stmt)).mappings().one()
            if sender == "vendedor":
                # Los ecos externos pueden ser de un dispositivo humano o de
                # otra automatización. El llamador lo indica explícitamente;
                # None conserva el comportamiento de los envíos directos
                # autenticados que ya pasan por este helper (p. ej. sticker).
                touch = (
                    touch_automated_reply_stmt
                    if human_outbound is False
                    else touch_last_read_stmt
                )
                await session.execute(touch(chat_id, datetime.now(timezone.utc)))

            await session.execute(touch_ultimo_mensaje_stmt(chat_id, now))
            await session.commit()
        except IntegrityError:
            await session.rollback()
            if wa_message_id is None:
                raise
            # El índice único de wa_message_id existe justamente para esto:
            # Evolution reenvía el mismo webhook sin confirmación, o el eco
            # de un mensaje saliente llega y se inserta por ese otro camino
            # antes de que esta llamada termine. La fila ya existe con el
            # mismo wa_message_id — se devuelve esa en vez de romper al
            # llamador (p. ej. una acción de automatización).
            row = (await session.execute(
                select(*_INSERT_MESSAGE_COLUMNS).where(WspMessage.wa_message_id == wa_message_id)
            )).mappings().one()

    return {
        "id": row["id"],
        "sender": row["sender"],
        "content": row["content"],
        "sent_at": _fmt_ts(row["sent_at"]),
        "media_url": row["media_url"],
        "wa_message_id": row["wa_message_id"],
        "status": row["status"],
        "message_type": row["message_type"],
        "analysis": row["analysis"],
        "payload": row["payload"],
        "quoted_wa_message_id": row["quoted_wa_message_id"],
        "media_width": row["media_width"],
        "media_height": row["media_height"],
    }


async def update_message_status(wa_message_id: str, status: str) -> dict | None:
    """Avanza el estado de un mensaje sin permitir regresiones.

    Los webhooks pueden llegar repetidos o fuera de orden. El ``WHERE`` hace
    atómica la comparación para que READ/PLAYED nunca vuelva a DELIVERY_ACK.
    Devuelve None si el ID no existe o el evento no aporta un estado nuevo.
    """
    status_rank = {
        "SERVER_ACK": 1,
        "DELIVERY_ACK": 2,
        "READ": 3,
        "PLAYED": 4,
        # Terminal: no debe poder pisarlo un ack tardío/duplicado, y una vez
        # aplicado tampoco debe "avanzar" a otra cosa (ver MESSAGE_STATUS_RANK
        # en message_status_service.py, misma regla).
        "REJECTED": 5,
    }
    incoming_rank = status_rank.get(status)
    if incoming_rank is None:
        return None

    current_rank = case(
        (WspMessage.status == "SERVER_ACK", 1),
        (WspMessage.status == "DELIVERY_ACK", 2),
        (WspMessage.status == "READ", 3),
        (WspMessage.status == "PLAYED", 4),
        (WspMessage.status == "REJECTED", 5),
        else_=0,
    )
    stmt = (
        update(WspMessage)
        .where(
            WspMessage.wa_message_id == wa_message_id,
            current_rank < incoming_rank,
        )
        .values(status=status)
        .returning(WspMessage.id, WspMessage.chat_id)
    )
    async with get_sessionmaker()() as session:
        row = (await session.execute(stmt)).mappings().first()
        if row is None:
            return None
        await session.commit()

    return {"id": row["id"], "chat_id": row["chat_id"], "status": status}


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

    El webhook de n8n manda el ``wa_message_id`` que acaba de insertar, así dos
    mensajes que entran casi a la vez no se pisan (buscar "el último" podía
    devolver el del otro chat)."""
    stmt = (
        _message_notification_stmt()
        .where(WspMessage.wa_message_id == wa_message_id)
        # Evolution puede reenviar el mismo wa_message_id; nos quedamos con la
        # fila más nueva.
        .order_by(WspMessage.id.desc())
        .limit(1)
    )
    async with get_sessionmaker()() as session:
        row = (await session.execute(stmt)).mappings().first()

    if row is None:
        return None
    return _message_notification_payload(row)


async def fetch_message_ad_payload(wa_message_id: str) -> dict | None:
    """`id` y `payload` de un mensaje, para rehospedar la miniatura del anuncio
    después de que n8n lo inserta. None si el `wa_message_id` no existe."""
    stmt = (
        select(WspMessage.id, WspMessage.payload)
        .where(WspMessage.wa_message_id == wa_message_id)
        .order_by(WspMessage.id.desc())
        .limit(1)
    )
    async with get_sessionmaker()() as session:
        row = (await session.execute(stmt)).mappings().first()
    if row is None:
        return None
    return {"id": row["id"], "payload": row["payload"]}


async def update_message_payload(message_id: int, payload: dict) -> None:
    """Reemplaza el JSONB `payload` de un mensaje."""
    stmt = update(WspMessage).where(WspMessage.id == message_id).values(payload=payload)
    async with get_sessionmaker()() as session:
        await session.execute(stmt)
        await session.commit()


async def existing_wa_message_ids(chat_id: str, wa_ids: list[str]) -> set[str]:
    """Cuáles de esos IDs de WhatsApp ya están registrados en el chat.

    Lo usa el historial traído de Evolution para no repetir en el hilo un
    mensaje que la base ya tiene.
    """
    if not wa_ids:
        return set()
    stmt = select(WspMessage.wa_message_id).where(
        WspMessage.chat_id == chat_id,
        WspMessage.wa_message_id.in_(wa_ids),
    )
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).scalars().all()
    return {r for r in rows if r}


async def count_wa_messages(chat_id: str) -> int:
    """Cuántos mensajes del chat hay registrados en la base."""
    stmt = select(func.count()).where(WspMessage.chat_id == chat_id)
    async with get_sessionmaker()() as session:
        return await session.scalar(stmt) or 0
