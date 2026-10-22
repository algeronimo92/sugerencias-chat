"""Casos de uso de la salida: encolar, reintentar, descartar y registrar envíos.

Todo mensaje saliente pasa por el outbox: el vendedor desde el chat, las
automatizaciones, los programados y los reenvíos. ``queue_messages`` guarda el
mensaje y su trabajo en la transacción del caso de uso; el worker lo manda
después y registra el resultado con ``record_sent``/``record_failed``.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.db.uow import collect, unit_of_work
from app.modules.conversations.application.ports import conversation_ports
from app.modules.conversations.domain.delivery import SendOutcome, is_final_failure
from app.modules.conversations.domain.errors import NotRetryable
from app.modules.conversations.domain.events import (
    MessageDiscarded,
    MessageFailed,
    MessageSent,
    OutboundQueued,
    ReactionChanged,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _with_quote(message: dict, reply_to: dict | None) -> dict:
    """La respuesta ya trae la cita resuelta: la burbuja optimista del
    frontend se reemplaza sin perder el recuadro citado."""
    return {
        **message,
        "quoted_message_id": reply_to["id"] if reply_to else None,
        "quoted_sender": reply_to["sender"] if reply_to else None,
        "quoted_content": reply_to.get("content") if reply_to else None,
    }


async def queue_messages(
    chat_id: str,
    items: list[dict],
    *,
    actor_user_id: int | None = None,
    author_user_id: int | None = None,
) -> list[dict]:
    """Encola uno o más mensajes en una sola transacción.

    Cada ítem trae ``message`` (el cuerpo Meta) y sus proyecciones para el CRM
    (``content``, ``media_url``, ``payload``); los adjuntos viajan como
    referencia al almacenamiento propio y se suben a Meta recién al enviar.
    ``reply_to`` es el mensaje citado ya resuelto; ``forwarded`` marca un
    reenvío; ``dedupe_key`` identifica el envío de forma estable (si ya se
    encoló, se devuelve ese mismo mensaje).

    ``actor_user_id`` es quien lo dispara ahora: con él cuenta como que un
    humano vio la conversación, sin él es "atendido por bot".
    ``author_user_id`` es a quién se le acredita cuando no es el actor (un
    programado es obra de quien lo programó). Sin él, el autor es el actor.
    """
    if not items:
        return []
    ports = conversation_ports()
    # Antes de abrir la transacción: un tipo que el proveedor no acepta se
    # rechaza sin haber creado nada.
    items = await ports.contract.prepare(items)
    sent_by_user_id = author_user_id if author_user_id is not None else actor_user_id
    now = _now()
    keys = [item["dedupe_key"] for item in items if item.get("dedupe_key")]
    results: list[dict] = []
    queued_ids: list[int] = []
    async with unit_of_work():
        already_queued = await ports.outbox.queued_by_dedupe_key(keys)
        for position, item in enumerate(items):
            reply_to = item.get("reply_to")
            existing = already_queued.get(item.get("dedupe_key"))
            if existing is not None:
                results.append(_with_quote(existing, reply_to))
                continue
            message = await ports.outbox.queue(
                chat_id, item,
                # Microsegundos distintos mantienen el orden del lote en los
                # clientes que ordenan por fecha.
                sent_at=now + timedelta(microseconds=position),
                sent_by_user_id=sent_by_user_id,
                actor_user_id=actor_user_id,
            )
            results.append(_with_quote(message, reply_to))
            queued_ids.append(message["id"])
        if queued_ids:
            if actor_user_id is not None:
                await ports.inbox.touch_human_reply(chat_id, now)
            else:
                await ports.inbox.touch_automated_reply(chat_id, now)
            collect(OutboundQueued(chat_id=chat_id, message_ids=tuple(queued_ids)))
    return results


async def queue_text(
    chat_id: str,
    text: str,
    reply_to: dict | None = None,
    *,
    actor_user_id: int | None = None,
    author_user_id: int | None = None,
    dedupe_key: str | None = None,
) -> dict:
    item = {**conversation_ports().contract.text(text), "reply_to": reply_to, "dedupe_key": dedupe_key}
    [message] = await queue_messages(chat_id, [item], actor_user_id=actor_user_id, author_user_id=author_user_id)
    return message


async def retry_failed_message(chat_id: str, message_id: int) -> dict:
    """Reactiva el mismo trabajo fallido, sin crear mensajes duplicados."""
    async with unit_of_work():
        message = await conversation_ports().outbox.reopen_failed(chat_id, message_id, _now())
        if message is None:
            raise NotRetryable()
        collect(OutboundQueued(chat_id=chat_id, message_ids=(message_id,)))
    return message


async def discard_failed_message(chat_id: str, message_id: int) -> dict:
    """Cierra un envío fallido que ya no vale la pena reintentar. No se borra:
    el historial tiene que seguir diciendo que nunca llegó."""
    async with unit_of_work():
        message = await conversation_ports().outbox.discard_failed(chat_id, message_id, _now())
        if message is None:
            raise NotRetryable()
        collect(MessageDiscarded(chat_id=chat_id, message_id=message_id))
    return message


async def record_sent(job: dict, receipt) -> None:
    """WhatsApp aceptó el mensaje: queda enviado con el cuerpo exacto que salió."""
    async with unit_of_work():
        scheduled = await conversation_ports().outbox.mark_sent(job, receipt, _now())
        actor_user_id = job["payload"].get("actor_user_id")
        collect(MessageSent(
            chat_id=job["chat_id"], message_id=job["message_id"],
            actor_user_id=int(actor_user_id) if actor_user_id is not None else None,
            scheduled=scheduled,
        ))


async def record_failed(job: dict, *, error: str, outcome: SendOutcome) -> None:
    """Un intento falló: se reprograma o, si fue el último, queda fallido."""
    attempts = job["attempts"] + 1
    exhausted = is_final_failure(attempts, outcome)
    async with unit_of_work():
        applied, scheduled = await conversation_ports().outbox.mark_failed(
            job, error=error[:2000], attempts=attempts, exhausted=exhausted, now=_now(),
        )
        if applied and exhausted:
            collect(MessageFailed(chat_id=job["chat_id"], message_id=job["message_id"], scheduled=scheduled))


async def send_reaction(chat_id: str, target_wa_message_id: str, emoji: str) -> dict | None:
    """Reacciona como el negocio (``emoji`` vacío la quita).

    Primero se manda a WhatsApp y recién con eso aceptado se guarda: una
    reacción que solo se viera de nuestro lado engañaría al vendedor.
    """
    ports = conversation_ports()
    message = ports.contract.reaction(target_wa_message_id, emoji)
    receipt = await ports.current_channel().sender.send(chat_id, message)
    async with unit_of_work():
        await ports.messages.record_reaction_event(
            event_wa_id=receipt.provider_message_id,
            target_wa_message_id=target_wa_message_id,
            chat_id=chat_id,
            emoji=emoji,
            actor="business",
            provider_payload=receipt.sent_body,
            occurred_at=_now(),
            webhook_event_id=None,
        )
        updated = await ports.messages.apply_reaction(chat_id, target_wa_message_id, emoji, from_me=True)
        if updated is not None:
            collect(ReactionChanged(chat_id=chat_id))
    return updated
