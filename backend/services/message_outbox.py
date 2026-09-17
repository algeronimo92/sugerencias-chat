import asyncio
import contextlib
import logging
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from enum import StrEnum
from time import monotonic, perf_counter

from sqlalchemy import exists, select, update
from sqlalchemy.orm import aliased

from db.models import MessageOutbox, ScheduledMessage, WspMessage
from domain_types import MessageStatus, OutboxStatus, ScheduledMessageStatus
from db.session import get_sessionmaker
from services.lead_touch import touch_automated_reply_stmt, touch_last_read_stmt
from services.media_storage import MediaNotFoundError
from services.outbound_kinds import OutboundDelivery, outbound_message_fields, send_outbound
from services.task_service import complete_reply_tasks
from services.whatsapp_channel import ChannelError, DeliveryUnconfirmedError, describe_send_failure
from services.whatsapp_channels import current_channel
from services.ws_manager import manager
from services.time_format import iso_utc_micros

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
WORKER_CONCURRENCY = 4
IDLE_POLL_SECONDS = 1.0
STALE_PROCESSING_AFTER = timedelta(minutes=5)
STALE_SWEEP_INTERVAL_SECONDS = 60.0
SHUTDOWN_GRACE_SECONDS = 8.0
RECORD_SENT_RETRY_DELAYS = (0.0, 0.5, 1.0, 2.0, 4.0)
# `_process_batch` procesa cada tanda con `asyncio.gather`: un solo job que se
# cuelgue (sin lanzar excepción, sin timeout propio) nunca deja terminar ese
# `gather`, así que el loop jamás vuelve a reclamar tandas nuevas -- todo el
# outbox queda congelado, no solo ese mensaje. Encontrado en vivo con un envío
# de plantilla con encabezado de imagen que se quedó en "processing" para
# siempre. Distinto del barrido de `_recover_stale_jobs` (que repone jobs
# huérfanos porque el proceso murió): este timeout cubre un proceso vivo con
# un job colgado, para que el resto del outbox pueda seguir andando.
JOB_TIMEOUT_SECONDS = 90


class SendOutcome(StrEnum):
    RETRYABLE = "retryable"
    DEFINITIVE = "definitive"
    UNCONFIRMED = "unconfirmed"


def _rejection_outcome(exc: ChannelError) -> SendOutcome:
    if exc.status_code is not None and (exc.status_code == 429 or exc.status_code >= 500):
        return SendOutcome.RETRYABLE
    return SendOutcome.DEFINITIVE


SEND_FAILURE_OUTCOMES: tuple[tuple[type[Exception], Callable[[Exception], SendOutcome]], ...] = (
    (DeliveryUnconfirmedError, lambda _exc: SendOutcome.UNCONFIRMED),
    (ChannelError, _rejection_outcome),
    (MediaNotFoundError, lambda _exc: SendOutcome.DEFINITIVE),
    (KeyError, lambda _exc: SendOutcome.DEFINITIVE),
    (ValueError, lambda _exc: SendOutcome.DEFINITIVE),
)


def classify_send_failure(exc: Exception) -> SendOutcome:
    for exc_type, outcome in SEND_FAILURE_OUTCOMES:
        if isinstance(exc, exc_type):
            return outcome(exc)
    return SendOutcome.RETRYABLE


def is_final_failure(attempts: int, outcome: SendOutcome) -> bool:
    return outcome is not SendOutcome.RETRYABLE or attempts >= MAX_ATTEMPTS

# El worker dormía IDLE_POLL_SECONDS entre rondas, así que un mensaje recién
# encolado esperaba hasta un segundo antes de salir hacia Evolution aunque el
# worker estuviera ocioso. Este aviso lo despierta en cuanto hay trabajo.
#
# Es in-process: vale mientras la API corra en un solo proceso. Con varias
# réplicas hace falta LISTEN/NOTIFY de PostgreSQL; el poll se conserva como
# respaldo para que la corrección no dependa del aviso.
_wakeup = asyncio.Event()


def notify_new_work() -> None:
    """Despierta al worker del outbox tras insertar trabajo nuevo."""
    _wakeup.set()


async def _wait_for_work() -> None:
    try:
        await asyncio.wait_for(_wakeup.wait(), timeout=IDLE_POLL_SECONDS)
    except asyncio.TimeoutError:
        pass
    finally:
        # Se limpia después de esperar, no antes: si el aviso llegó mientras
        # el worker procesaba la ronda anterior, perderlo devolvería el
        # retardo de un segundo que este mecanismo viene a eliminar.
        _wakeup.clear()


async def enqueue_text_message(
    chat_id: str,
    text: str,
    reply_to: dict | None = None,
    *,
    actor_user_id: int | None = None,
    dedupe_key: str | None = None,
) -> dict:
    return (await enqueue_messages(chat_id, [{
        "content": text,
        "payload": {"type": "text", "text": text},
        "reply_to": reply_to,
        "dedupe_key": dedupe_key,
    }], actor_user_id=actor_user_id))[0]


def quoted_context(target: dict) -> dict:
    """Contexto que Meta necesita para que la cita se vea en WhatsApp.

    A diferencia de Evolution/Baileys (que exigía una key/message falsa con
    el texto recortado del original), la Graph API de Meta solo pide el
    wa_message_id del mensaje citado -ella misma resuelve el resto del lado
    del cliente- ver meta_service.send_whatsapp_text."""
    return {"wa_message_id": target["wa_message_id"]}


def _message_dict(message: WspMessage, reply_to: dict | None = None) -> dict:
    return {
        "id": message.id,
        "sender": message.sender,
        "content": message.content,
        "sent_at": iso_utc_micros(message.sent_at),
        "media_url": message.media_url,
        "wa_message_id": message.wa_message_id,
        "status": message.status,
        "message_type": message.message_type,
        "analysis": message.analysis,
        "payload": message.payload,
        # La respuesta del POST ya trae la cita resuelta: la burbuja optimista
        # del frontend se reemplaza por esta sin perder el recuadro citado ni
        # esperar al siguiente refetch del historial.
        "quoted_message_id": reply_to["id"] if reply_to else None,
        "quoted_sender": reply_to["sender"] if reply_to else None,
        "quoted_content": reply_to.get("content") if reply_to else None,
    }


async def enqueue_messages(
    chat_id: str,
    items: list[dict],
    *,
    actor_user_id: int | None = None,
) -> list[dict]:
    """Guarda uno o más mensajes y sus trabajos en una sola transacción.

    El payload contiene únicamente metadatos pequeños. Los archivos ya deben
    estar en el almacenamiento multimedia y se referencian por ``media_url``.

    ``reply_to`` (opcional) es el mensaje citado ya resuelto por el llamador
    —ver ``db_service.fetch_reply_target``—; debe traer ``wa_message_id``.

    ``forwarded`` (opcional) marca el mensaje como reenviado: solo agrega la
    etiqueta "Reenviado" de la burbuja, el envío a WhatsApp es idéntico.

    ``dedupe_key`` (opcional) identifica el envío de forma estable: si ya se
    encoló un mensaje con esa clave, se devuelve ese mismo en lugar de crear
    otro.
    """
    if not items:
        return []
    now = datetime.now(timezone.utc)
    queued: list[tuple[WspMessage, dict | None]] = []
    inserted = False
    dedupe_keys = [item["dedupe_key"] for item in items if item.get("dedupe_key")]
    async with get_sessionmaker()() as session:
        already_queued = await _messages_by_dedupe_key(session, dedupe_keys)
        for position, item in enumerate(items):
            reply_to = item.get("reply_to")
            existing = already_queued.get(item.get("dedupe_key"))
            if existing is not None:
                queued.append((existing, reply_to))
                continue
            payload = item["payload"]
            if actor_user_id is not None:
                payload = {**payload, "_actor_user_id": actor_user_id}
            message_type, db_payload = outbound_message_fields(payload)
            if item.get("forwarded"):
                db_payload = {**(db_payload or {}), "forwarded": True}
            if reply_to:
                payload = {**payload, "quoted": quoted_context(reply_to)}
            message = WspMessage(
                chat_id=chat_id,
                sender="vendedor",
                content=item.get("content"),
                # IDs resuelven empates, pero microsegundos distintos también
                # mantienen el orden al mezclar mensajes en clientes antiguos.
                sent_at=now + timedelta(microseconds=position),
                media_url=item.get("media_url"),
                status=MessageStatus.PENDING,
                quoted_wa_message_id=reply_to["wa_message_id"] if reply_to else None,
                message_type=message_type,
                payload=db_payload,
            )
            session.add(message)
            await session.flush()
            session.add(MessageOutbox(
                message_id=message.id,
                chat_id=chat_id,
                payload=payload,
                status=OutboxStatus.PENDING,
                next_attempt_at=now,
                dedupe_key=item.get("dedupe_key"),
            ))
            queued.append((message, reply_to))
            inserted = True
        if not inserted:
            return [_message_dict(message, reply_to) for message, reply_to in queued]
        # actor_user_id solo viene poblado cuando el envío lo dispara un
        # vendedor logueado desde la app: eso cuenta como que un humano vio
        # la conversación. Sin actor_user_id es una automatización — no
        # implica que nadie del equipo haya visto el mensaje del cliente,
        # así que solo se registra como "atendido por bot" (ver
        # last_automated_reply_at en lead_touch.touch_automated_reply_stmt).
        stmt = (
            touch_last_read_stmt(chat_id, now)
            if actor_user_id is not None
            else touch_automated_reply_stmt(chat_id, now)
        )
        await session.execute(stmt)
        await session.commit()
    notify_new_work()
    return [_message_dict(message, reply_to) for message, reply_to in queued]


async def _messages_by_dedupe_key(session, dedupe_keys: list[str]) -> dict[str, WspMessage]:
    if not dedupe_keys:
        return {}
    rows = await session.execute(
        select(MessageOutbox.dedupe_key, WspMessage)
        .join(WspMessage, WspMessage.id == MessageOutbox.message_id)
        .where(MessageOutbox.dedupe_key.in_(dedupe_keys))
    )
    return {dedupe_key: message for dedupe_key, message in rows.all()}


async def retry_failed_message(chat_id: str, message_id: int) -> dict | None:
    """Reactiva el mismo trabajo fallido, sin crear mensajes duplicados."""
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        job = (await session.execute(
            select(MessageOutbox)
            .join(WspMessage, WspMessage.id == MessageOutbox.message_id)
            .where(
                MessageOutbox.message_id == message_id,
                MessageOutbox.chat_id == chat_id,
                MessageOutbox.status == OutboxStatus.FAILED,
                WspMessage.status == MessageStatus.FAILED,
            )
            .with_for_update()
        )).scalar_one_or_none()
        if job is None:
            return None
        message = await session.get(WspMessage, message_id)
        if message is None:  # pragma: no cover - protegido por el JOIN
            return None
        job.status = OutboxStatus.PENDING
        job.attempts = 0
        job.next_attempt_at = now
        job.last_error = None
        job.updated_at = now
        message.status = MessageStatus.PENDING
        message.wa_message_id = None
        # La cita se relee antes del commit para que la respuesta del reintento
        # traiga el mismo recuadro citado que traía el envío original; el
        # payload de la outbox ya la conserva intacta.
        reply_to = await _quoted_message(session, chat_id, message.quoted_wa_message_id)
        await session.commit()
        notify_new_work()
        return _message_dict(message, reply_to)


async def discard_failed_message(chat_id: str, message_id: int) -> dict | None:
    """Cierra un envío fallido que ya no vale la pena reintentar.

    Es la contraparte de ``retry_failed_message``: misma precondición (job
    fallido con su mensaje en FAILED), decisión opuesta. El job sale de
    ``failed`` —por eso deja de contar en ``outbox_failed``, que solo mira ese
    estado— y el mensaje queda en DISCARDED, sin botón de reintento.

    No se borra nada, y el estado es distinto de "enviado" a propósito: el
    mensaje nunca llegó al cliente y el historial tiene que seguir diciéndolo.
    """
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        job = (await session.execute(
            select(MessageOutbox)
            .join(WspMessage, WspMessage.id == MessageOutbox.message_id)
            .where(
                MessageOutbox.message_id == message_id,
                MessageOutbox.chat_id == chat_id,
                MessageOutbox.status == OutboxStatus.FAILED,
                WspMessage.status == MessageStatus.FAILED,
            )
            .with_for_update()
        )).scalar_one_or_none()
        if job is None:
            return None
        message = await session.get(WspMessage, message_id)
        if message is None:  # pragma: no cover - protegido por el JOIN
            return None
        job.status = OutboxStatus.DISCARDED
        job.updated_at = now
        message.status = MessageStatus.DISCARDED
        reply_to = await _quoted_message(session, chat_id, message.quoted_wa_message_id)
        await session.commit()
    await manager.broadcast({
        "type": "chats_updated",
        "chat_id": chat_id,
        "reason": "message_status",
        "message_statuses": [{"id": message_id, "status": MessageStatus.DISCARDED}],
    })
    return _message_dict(message, reply_to)


async def _quoted_message(session, chat_id: str, wa_message_id: str | None) -> dict | None:
    if not wa_message_id:
        return None
    row = (await session.execute(
        select(WspMessage.id, WspMessage.sender, WspMessage.content).where(
            WspMessage.chat_id == chat_id,
            WspMessage.wa_message_id == wa_message_id,
        )
    )).mappings().first()
    return dict(row) if row is not None else None


async def _recover_stale_jobs() -> None:
    """Recupera jobs que quedaron en "processing" porque el proceso murió a
    mitad de camino (crash, `docker restart`, OOM), no porque estén realmente
    trabados con el worker vivo (para eso está `JOB_TIMEOUT_SECONDS`)."""
    cutoff = datetime.now(timezone.utc) - STALE_PROCESSING_AFTER
    async with get_sessionmaker()() as session:
        rows = (await session.execute(
            select(
                MessageOutbox.id,
                MessageOutbox.message_id,
                MessageOutbox.chat_id,
                MessageOutbox.payload,
                MessageOutbox.attempts,
            ).where(MessageOutbox.status == OutboxStatus.PROCESSING, MessageOutbox.updated_at < cutoff)
        )).mappings().all()
    for row in rows:
        logger.warning(
            "El mensaje %s del outbox quedó en processing sin terminar; se marca sin confirmar",
            row["message_id"],
        )
        await _mark_failed(
            dict(row), DeliveryUnconfirmedError(), SendOutcome.UNCONFIRMED,
        )


async def _claim_batch() -> list[dict]:
    now = datetime.now(timezone.utc)
    earlier = aliased(MessageOutbox)
    has_earlier_unsent = exists(
        select(earlier.id).where(
            earlier.chat_id == MessageOutbox.chat_id,
            earlier.id < MessageOutbox.id,
            earlier.status.in_((OutboxStatus.PENDING, OutboxStatus.PROCESSING)),
        )
    )
    stmt = (
        select(MessageOutbox)
        .where(
            MessageOutbox.status == OutboxStatus.PENDING,
            MessageOutbox.next_attempt_at <= now,
            ~has_earlier_unsent,
        )
        .order_by(MessageOutbox.id)
        .limit(WORKER_CONCURRENCY)
        .with_for_update(skip_locked=True)
    )
    async with get_sessionmaker()() as session:
        jobs = (await session.execute(stmt)).scalars().all()
        claimed = []
        for job in jobs:
            job.status = OutboxStatus.PROCESSING
            job.updated_at = now
            claimed.append({
                "id": job.id,
                "message_id": job.message_id,
                "chat_id": job.chat_id,
                "payload": job.payload,
                "attempts": job.attempts,
            })
        await session.commit()
    return claimed


async def _record_sent(job: dict, delivery: OutboundDelivery) -> bool:
    wa_id = delivery.receipt.provider_message_id
    delivered_content = delivery.delivered_content
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        await session.execute(
            update(MessageOutbox)
            .where(MessageOutbox.id == job["id"])
            .values(status=OutboxStatus.SENT, attempts=job["attempts"] + 1, last_error=None, updated_at=now)
        )
        message_values = {"wa_message_id": wa_id, "status": MessageStatus.SERVER_ACK}
        if delivered_content is not None:
            message_values["content"] = delivered_content
        await session.execute(
            update(WspMessage)
            .where(WspMessage.id == job["message_id"])
            .values(**message_values)
        )
        scheduled_result = await session.execute(
            update(ScheduledMessage)
            .where(ScheduledMessage.queued_message_id == job["message_id"])
            .values(status=ScheduledMessageStatus.SENT, error=None, updated_at=now)
        )
        await session.commit()
    return bool(scheduled_result.rowcount)


async def _announce_sent(job: dict, scheduled_updated: bool) -> None:
    actor_user_id = job["payload"].get("_actor_user_id")
    completed_tasks = 0
    if actor_user_id is not None:
        try:
            completed_tasks = await complete_reply_tasks(job["chat_id"], int(actor_user_id))
        except Exception:
            logger.exception(
                "No se pudieron completar las tareas del lead %s tras responder",
                job["chat_id"],
            )
    try:
        await manager.broadcast({
            "type": "chats_updated",
            "chat_id": job["chat_id"],
            "reason": "outbound_message",
            "message_statuses": [{"id": job["message_id"], "status": MessageStatus.SERVER_ACK}],
        })
        if completed_tasks:
            await manager.broadcast({"type": "tasks_updated"})
        if scheduled_updated:
            await manager.broadcast({
                "type": "scheduled_messages_updated",
                "chat_id": job["chat_id"],
                "status": ScheduledMessageStatus.SENT,
            })
    except Exception:
        logger.exception("No se pudo avisar el envío del mensaje %s", job["message_id"])


async def _persist_sent(job: dict, delivery: OutboundDelivery) -> bool:
    for delay in RECORD_SENT_RETRY_DELAYS:
        await asyncio.sleep(delay)
        try:
            scheduled_updated = await _record_sent(job, delivery)
        except Exception:
            logger.warning(
                "WhatsApp aceptó el mensaje %s pero no se pudo registrar como enviado",
                job["message_id"], exc_info=True,
            )
            continue
        await _announce_sent(job, scheduled_updated)
        return True
    logger.error(
        "El mensaje %s salió hacia WhatsApp y no quedó registrado como enviado",
        job["message_id"],
    )
    return False


async def _mark_failed(job: dict, exc: Exception, outcome: SendOutcome) -> None:
    attempts = job["attempts"] + 1
    exhausted = is_final_failure(attempts, outcome)
    now = datetime.now(timezone.utc)
    delay = timedelta(seconds=2 ** attempts)
    error = describe_send_failure(exc, "enviar el mensaje a WhatsApp")[:2000]
    scheduled_updated = False
    async with get_sessionmaker()() as session:
        job_result = await session.execute(
            update(MessageOutbox)
            .where(MessageOutbox.id == job["id"], MessageOutbox.status == OutboxStatus.PROCESSING)
            .values(
                status=OutboxStatus.FAILED if exhausted else OutboxStatus.PENDING,
                attempts=attempts,
                next_attempt_at=now + delay,
                last_error=error,
                updated_at=now,
            )
        )
        if not job_result.rowcount:
            await session.rollback()
            return
        if exhausted:
            await session.execute(
                update(WspMessage)
                .where(WspMessage.id == job["message_id"])
                .values(status=MessageStatus.FAILED)
            )
            scheduled_result = await session.execute(
                update(ScheduledMessage)
                .where(ScheduledMessage.queued_message_id == job["message_id"])
                .values(status=ScheduledMessageStatus.FAILED, error=error, updated_at=now)
            )
            scheduled_updated = bool(scheduled_result.rowcount)
        await session.commit()
    if exhausted:
        await manager.broadcast({
            "type": "chats_updated",
            "chat_id": job["chat_id"],
            "reason": "message_status",
            "message_statuses": [{"id": job["message_id"], "status": MessageStatus.FAILED}],
        })
        if scheduled_updated:
            await manager.broadcast({
                "type": "scheduled_messages_updated",
                "chat_id": job["chat_id"],
                "status": ScheduledMessageStatus.FAILED,
            })


async def _process_job(job: dict) -> None:
    started_at = perf_counter()
    payload = job["payload"]
    try:
        delivery = await asyncio.wait_for(
            send_outbound(current_channel().sender, job["chat_id"], payload),
            timeout=JOB_TIMEOUT_SECONDS,
        )
    except asyncio.CancelledError:
        await asyncio.shield(_mark_failed(
            job, DeliveryUnconfirmedError(), SendOutcome.UNCONFIRMED,
        ))
        raise
    except Exception as exc:
        outcome = classify_send_failure(exc)
        logger.warning(
            "Falló el mensaje %s del outbox (%s): %s", job["message_id"], outcome, exc,
        )
        await _mark_failed(job, exc, outcome)
        return
    logger.info(
        "Mensaje %s del outbox (%s) enviado vía Meta en %.0fms",
        job["message_id"], payload.get("type"),
        (perf_counter() - started_at) * 1000,
    )
    await asyncio.shield(_persist_sent(job, delivery))


async def _process_batch(jobs: list[dict]) -> None:
    batch = asyncio.gather(*(_process_job(job) for job in jobs))
    try:
        await asyncio.shield(batch)
    except asyncio.CancelledError:
        await asyncio.wait({batch}, timeout=SHUTDOWN_GRACE_SECONDS)
        if not batch.done():
            batch.cancel()
        with contextlib.suppress(asyncio.CancelledError, Exception):
            await batch
        raise


async def watch_message_outbox() -> None:
    next_sweep_at = 0.0
    while True:
        try:
            if monotonic() >= next_sweep_at:
                next_sweep_at = monotonic() + STALE_SWEEP_INTERVAL_SECONDS
                await _recover_stale_jobs()
            jobs = await _claim_batch()
            if jobs:
                await _process_batch(jobs)
                continue
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error al procesar el outbox de mensajes")
        await _wait_for_work()
