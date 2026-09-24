from datetime import datetime, timezone

from sqlalchemy import func, select

from db.models import WspMessage
from db.session import get_sessionmaker
from services.store.message_serialization import mask_deleted as _mask_deleted, serialize_message


def _message_payload(row: WspMessage) -> dict:
    """Un mensaje en la forma del schema Message, desde una fila ORM."""
    return serialize_message(row)


async def set_message_reaction(
    chat_id: str, target_wa_message_id: str, emoji: str, from_me: bool
) -> dict | None:
    """Aplica una reacción sobre el mensaje objetivo y devuelve ese mensaje ya
    actualizado, o None si el objetivo no está en la base (p. ej. una reacción
    a un mensaje histórico anterior a la integración).

    El objetivo se resuelve por (chat_id, wa_message_id), igual que los citados,
    apoyándose en el índice único de wa_message_id. Una reacción por lado:
    reemplaza la entrada del mismo `from_me`; un emoji vacío la quita (así WhatsApp
    modela quitar la reacción). Es el único lugar con la lógica de merge — lo
    usan tanto el webhook entrante como el envío del vendedor.
    """
    async with get_sessionmaker()() as session:
        row = (await session.execute(
            select(WspMessage).where(
                WspMessage.chat_id == chat_id,
                WspMessage.wa_message_id == target_wa_message_id,
            )
        )).scalar_one_or_none()
        if row is None:
            return None

        reactions = [r for r in (row.reactions or []) if r.get("from_me") != from_me]
        if emoji:
            reactions.append({"emoji": emoji, "from_me": from_me})
        row.reactions = reactions or None
        await session.commit()
        return _message_payload(row)


async def _load_message_by_wa_id(session, chat_id: str, wa_message_id: str) -> WspMessage | None:
    return (await session.execute(
        select(WspMessage).where(
            WspMessage.chat_id == chat_id,
            WspMessage.wa_message_id == wa_message_id,
        )
    )).scalar_one_or_none()


async def _load_message_by_id(session, chat_id: str, message_id: int) -> WspMessage | None:
    return (await session.execute(
        select(WspMessage).where(WspMessage.id == message_id, WspMessage.chat_id == chat_id)
    )).scalar_one_or_none()


# WhatsApp nativo deja fijar hasta 3 mensajes por chat (y pide desfijar uno
# para agregar un cuarto); se replica el mismo límite acá aunque el fijado en
# sí no se pueda mandar hacia WhatsApp (ver el comentario en db/models.py).
MAX_PINNED_MESSAGES = 3


class PinLimitReachedError(Exception):
    """Ya hay MAX_PINNED_MESSAGES mensajes fijados en el chat."""


async def fetch_pinned_messages(chat_id: str) -> list[dict]:
    """Los mensajes fijados del chat (a lo sumo MAX_PINNED_MESSAGES), del más
    viejo al más nuevo — mismo orden en que se navega el carrusel de fijados."""
    stmt = (
        select(WspMessage)
        .where(WspMessage.chat_id == chat_id, WspMessage.pinned_at.isnot(None))
        .order_by(WspMessage.pinned_at.asc())
        .limit(MAX_PINNED_MESSAGES)
    )
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).scalars().all()
    return [_message_payload(row) for row in rows]


async def pin_message(chat_id: str, message_id: int, user_id: int) -> dict | None:
    """Fija un mensaje (fijado nativo del CRM, no se manda a WhatsApp — no hay
    forma de hacerlo, ver db/models.py). None si el mensaje no existe en el
    chat o ya está eliminado. Levanta PinLimitReachedError si el chat ya tiene
    MAX_PINNED_MESSAGES fijados y este no es uno de ellos. Idempotente: fijar
    uno ya fijado no cambia su lugar en el carrusel."""
    async with get_sessionmaker()() as session:
        row = await _load_message_by_id(session, chat_id, message_id)
        if row is None or row.deleted_at is not None:
            return None
        if row.pinned_at is None:
            count = await session.scalar(
                select(func.count()).where(
                    WspMessage.chat_id == chat_id, WspMessage.pinned_at.isnot(None),
                )
            )
            if count >= MAX_PINNED_MESSAGES:
                raise PinLimitReachedError()
            row.pinned_at = datetime.now(timezone.utc)
            row.pinned_by_user_id = user_id
            await session.commit()
        return _message_payload(row)


async def unpin_message(chat_id: str, message_id: int) -> dict | None:
    """Desfija un mensaje. None si no existe en el chat. Idempotente."""
    async with get_sessionmaker()() as session:
        row = await _load_message_by_id(session, chat_id, message_id)
        if row is None:
            return None
        if row.pinned_at is not None:
            row.pinned_at = None
            row.pinned_by_user_id = None
            await session.commit()
        return _message_payload(row)
