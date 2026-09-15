from datetime import datetime, timezone

from sqlalchemy import func, select

from db.models import WspMessage
from db.session import get_sessionmaker
from services.message_edit_crypto import decrypt_edited_text
from services.store.common import (
    _fmt_ts,
)


def _mask_deleted(item: dict) -> dict:
    """Vacía lo que un mensaje eliminado ya no debe mostrar.

    El borrado es lógico (la fila queda para la auditoría del CRM), así que el
    ocultamiento se hace acá, al servir: un solo lugar para los dos caminos que
    devuelven mensajes (el hilo paginado y la fila suelta que devuelven las
    mutaciones). `sender`, `sent_at` y `status` se conservan — son los que
    permiten ubicar la lápida en el hilo, igual que WhatsApp.
    """
    if not item.get("deleted_at"):
        return item
    return {
        **item,
        "content": None,
        "media_url": None,
        "analysis": None,
        "payload": None,
        "media_width": None,
        "media_height": None,
    }


def _message_payload(row: WspMessage) -> dict:
    """Un mensaje en la forma que espera el schema Message (misma que arma
    fetch_messages), a partir de una fila ORM ya cargada."""
    return _mask_deleted({
        "id": row.id,
        "sender": row.sender,
        "content": row.content,
        "sent_at": _fmt_ts(row.sent_at),
        "media_url": row.media_url,
        "wa_message_id": row.wa_message_id,
        "status": row.status,
        "message_type": row.message_type,
        "analysis": row.analysis,
        "payload": row.payload,
        "reactions": row.reactions,
        "edited_at": _fmt_ts(row.edited_at),
        "deleted_at": _fmt_ts(row.deleted_at),
        "pinned_at": _fmt_ts(row.pinned_at),
        "media_width": row.media_width or None,
        "media_height": row.media_height or None,
    })


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


def merge_poll_results_payload(
    current: dict | None,
    results: list[dict],
    *,
    voter_id: str | None = None,
    mode: str = "snapshot",
) -> dict:
    """Merge puro e idempotente de snapshot o voto individual."""
    payload = dict(current or {})
    if mode == "delta" and voter_id:
        votes = dict(payload.get("votes_by_voter") or {})
        selected = [str(result.get("option")) for result in results if result.get("option")]
        if selected:
            votes[voter_id] = selected
        else:
            votes.pop(voter_id, None)
        counts: dict[str, int] = {}
        for options in votes.values():
            if not isinstance(options, list):
                continue
            for option in set(map(str, options)):
                counts[option] = counts.get(option, 0) + 1
        payload["votes_by_voter"] = votes
        payload["results"] = [
            {"option": option, "count": count}
            for option, count in counts.items()
        ]
    else:
        payload["results"] = results
    if voter_id:
        payload["last_voter_id"] = voter_id
    payload["results_updated_at"] = _fmt_ts(datetime.now(timezone.utc))
    return payload


async def update_poll_results(
    chat_id: str,
    target_wa_message_id: str,
    results: list[dict],
    *,
    voter_id: str | None = None,
    mode: str = "snapshot",
) -> dict | None:
    """Actualiza la encuesta original; nunca crea una fila para el voto."""
    async with get_sessionmaker()() as session:
        row = await _load_message_by_wa_id(session, chat_id, target_wa_message_id)
        if row is None or row.message_type != "poll" or row.deleted_at is not None:
            return None

        row.payload = merge_poll_results_payload(
            row.payload, results, voter_id=voter_id, mode=mode
        )
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


async def update_message_content(chat_id: str, wa_message_id: str, text: str) -> dict | None:
    """Guarda el texto nuevo de un mensaje editado y devuelve el mensaje ya
    actualizado, o None si no está en la base.

    El objetivo se resuelve por (chat_id, wa_message_id) —  igual que las
    reacciones— para que sirva tanto a la edición hecha desde la app como a la
    que llega por webhook cuando el vendedor edita desde el teléfono.

    Se guarda solo el texto vigente: WhatsApp tampoco conserva las versiones
    anteriores, y `edited_at` es lo único que la burbuja necesita para mostrar
    el "Editado". Un mensaje eliminado no se reescribe.
    """
    async with get_sessionmaker()() as session:
        row = await _load_message_by_wa_id(session, chat_id, wa_message_id)
        if row is None or row.deleted_at is not None:
            return None

        row.content = text
        row.edited_at = datetime.now(timezone.utc)
        await session.commit()
        return _message_payload(row)


async def update_message_content_from_secret(
    chat_id: str,
    wa_message_id: str,
    sender_candidates: list[str],
    enc_payload: bytes,
    enc_iv: bytes,
) -> dict | None:
    """Versión de `update_message_content` para la edición nativa cifrada
    (`secretEncryptedMessage`): descifra con el `message_secret` guardado del
    mensaje original y, si se pudo, aplica el mismo cambio.

    Devuelve None —sin tocar la fila— tanto si el mensaje no está en la base
    como si el descifrado falla (secreto no guardado porque el mensaje es
    anterior a esta migración, o ningún candidato de sender valida): un
    intento fallido nunca debe corromper `content` con basura.
    """
    async with get_sessionmaker()() as session:
        row = await _load_message_by_wa_id(session, chat_id, wa_message_id)
        if row is None or row.deleted_at is not None or row.message_secret is None:
            return None

        text = decrypt_edited_text(
            secret=row.message_secret,
            message_id=wa_message_id,
            sender_candidates=sender_candidates,
            enc_payload=enc_payload,
            enc_iv=enc_iv,
        )
        if text is None:
            return None

        row.content = text
        row.edited_at = datetime.now(timezone.utc)
        await session.commit()
        return _message_payload(row)


async def mark_message_deleted(chat_id: str, wa_message_id: str) -> dict | None:
    """Marca un mensaje como eliminado para todos y devuelve el mensaje ya
    actualizado, o None si no está en la base.

    Borrado lógico: la fila queda (el CRM no pierde el registro de que hubo un
    mensaje ahí), pero desde acá en adelante la API no sirve su contenido
    —lo tapa `_mask_deleted`—. Idempotente: volver a eliminar algo ya
    eliminado conserva la marca original en vez de correrla.
    """
    async with get_sessionmaker()() as session:
        row = await _load_message_by_wa_id(session, chat_id, wa_message_id)
        if row is None:
            return None

        if row.deleted_at is None:
            row.deleted_at = datetime.now(timezone.utc)
            await session.commit()
        return _message_payload(row)
