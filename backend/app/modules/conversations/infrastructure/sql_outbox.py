"""Persistencia del outbox en PostgreSQL.

``SqlOutboxStore`` implementa el puerto ``OutboxStore`` sobre la sesión del
caso de uso. ``claim_batch`` y ``stale_jobs`` son las consultas propias del
worker. Es el único lugar que construye filas de ``message_outbox`` (ver
``tests/test_layering.py``): quien arme la fila por su cuenta se pierde la
deduplicación, el touch de la bandeja y el aviso al worker.
"""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import exists, select, update
from sqlalchemy.orm import aliased

from app.db.models.conversations import MessageOutbox, ScheduledMessage, WspMessage
from app.db.uow import current_session, session_scope
from app.modules.conversations.domain.delivery import retry_delay, statuses_after_failure
from app.modules.conversations.message_serialization import serialize_message
from app.modules.conversations.domain.types import MessageOutboxStatus, OutboxStatus, ScheduledMessageStatus

WORKER_CONCURRENCY = 4


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


def _with_quote(message: WspMessage, reply_to: dict | None) -> dict:
    return {
        **serialize_message(message),
        "quoted_message_id": reply_to["id"] if reply_to else None,
        "quoted_sender": reply_to["sender"] if reply_to else None,
        "quoted_content": reply_to.get("content") if reply_to else None,
    }


async def _failed_job(session, chat_id: str, message_id: int):
    return (await session.execute(
        select(MessageOutbox)
        .join(WspMessage, WspMessage.id == MessageOutbox.message_id)
        .where(
            MessageOutbox.message_id == message_id,
            MessageOutbox.chat_id == chat_id,
            MessageOutbox.status == OutboxStatus.FAILED,
            WspMessage.outbox_status == MessageOutboxStatus.FAILED,
        )
        .with_for_update()
    )).scalar_one_or_none()


class SqlOutboxStore:
    async def queued_by_dedupe_key(self, keys: list[str]) -> dict[str, dict]:
        if not keys:
            return {}
        rows = await current_session().execute(
            select(MessageOutbox.dedupe_key, WspMessage)
            .join(WspMessage, WspMessage.id == MessageOutbox.message_id)
            .where(MessageOutbox.dedupe_key.in_(keys))
        )
        return {dedupe_key: serialize_message(message) for dedupe_key, message in rows.all()}

    async def queue(
        self, chat_id: str, item: dict, *, sent_at: datetime, sent_by_user_id: int | None,
        actor_user_id: int | None,
    ) -> dict:
        session = current_session()
        message_body = item["message"]
        reply_to = item.get("reply_to")
        payload = item.get("payload")
        if item.get("forwarded"):
            payload = {**(payload or {}), "forwarded": True}
        message = WspMessage(
            chat_id=chat_id,
            sender="vendedor",
            # Quién lo mandó, consultable sin abrir el payload del outbox.
            # NULL en los envíos de automatización: no son trabajo de nadie.
            sent_by_user_id=sent_by_user_id,
            content=item.get("content"),
            sent_at=sent_at,
            media_url=item.get("media_url"),
            outbox_status=MessageOutboxStatus.QUEUED,
            quoted_wa_message_id=reply_to["wa_message_id"] if reply_to else None,
            message_type=message_body["type"],
            message_subtype=item.get("message_subtype"),
            # Provisorio hasta el envío: el worker lo reemplaza por el cuerpo
            # exacto que salió (con destinatario e ids de medios).
            provider_payload=message_body,
            payload=payload,
        )
        session.add(message)
        await session.flush()
        session.add(MessageOutbox(
            message_id=message.id,
            chat_id=chat_id,
            payload={
                "message": message_body,
                "media": item.get("media"),
                "header_media": item.get("header_media"),
                "actor_user_id": actor_user_id,
            },
            status=OutboxStatus.PENDING,
            next_attempt_at=sent_at,
            dedupe_key=item.get("dedupe_key"),
        ))
        await session.flush()
        await session.refresh(message)
        return serialize_message(message)

    async def reopen_failed(self, chat_id: str, message_id: int, now: datetime) -> dict | None:
        session = current_session()
        job = await _failed_job(session, chat_id, message_id)
        if job is None:
            return None
        message = await session.get(WspMessage, message_id)
        job.status = OutboxStatus.PENDING
        job.attempts = 0
        job.next_attempt_at = now
        job.last_error = None
        job.updated_at = now
        message.outbox_status = MessageOutboxStatus.QUEUED
        message.wa_message_id = None
        # La cita se relee para que la respuesta del reintento traiga el mismo
        # recuadro citado que el envío original.
        reply_to = await _quoted_message(session, chat_id, message.quoted_wa_message_id)
        await session.flush()
        await session.refresh(message)
        return _with_quote(message, reply_to)

    async def discard_failed(self, chat_id: str, message_id: int, now: datetime) -> dict | None:
        session = current_session()
        job = await _failed_job(session, chat_id, message_id)
        if job is None:
            return None
        message = await session.get(WspMessage, message_id)
        # Sale de ``failed`` (deja de contar como fallido) pero no queda como
        # enviado: el mensaje nunca llegó al cliente.
        job.status = OutboxStatus.DISCARDED
        job.updated_at = now
        message.outbox_status = MessageOutboxStatus.DISCARDED
        reply_to = await _quoted_message(session, chat_id, message.quoted_wa_message_id)
        await session.flush()
        await session.refresh(message)
        return _with_quote(message, reply_to)

    async def mark_sent(self, job: dict, receipt, now: datetime) -> bool:
        session = current_session()
        await session.execute(
            update(MessageOutbox)
            .where(MessageOutbox.id == job["id"])
            .values(status=OutboxStatus.SENT, attempts=job["attempts"] + 1, last_error=None, updated_at=now)
        )
        await session.execute(
            update(WspMessage)
            .where(WspMessage.id == job["message_id"])
            .values(
                wa_message_id=receipt.provider_message_id,
                outbox_status=MessageOutboxStatus.SENT,
                provider_payload=receipt.sent_body,
            )
        )
        scheduled = await session.execute(
            update(ScheduledMessage)
            .where(ScheduledMessage.queued_message_id == job["message_id"])
            .values(status=ScheduledMessageStatus.SENT, error=None, updated_at=now)
        )
        return bool(scheduled.rowcount)

    async def mark_failed(
        self, job: dict, *, error: str, attempts: int, exhausted: bool, now: datetime,
    ) -> tuple[bool, bool]:
        session = current_session()
        job_status, message_status = statuses_after_failure(exhausted)
        applied = await session.execute(
            update(MessageOutbox)
            .where(MessageOutbox.id == job["id"], MessageOutbox.status == OutboxStatus.PROCESSING)
            .values(
                status=job_status,
                attempts=attempts,
                next_attempt_at=now + retry_delay(attempts),
                last_error=error,
                updated_at=now,
            )
        )
        if not applied.rowcount:
            return False, False
        await session.execute(
            update(WspMessage).where(WspMessage.id == job["message_id"]).values(outbox_status=message_status)
        )
        scheduled = False
        if exhausted:
            result = await session.execute(
                update(ScheduledMessage)
                .where(ScheduledMessage.queued_message_id == job["message_id"])
                .values(status=ScheduledMessageStatus.FAILED, error=error, updated_at=now)
            )
            scheduled = bool(result.rowcount)
        return True, scheduled


def _job(row) -> dict:
    return {
        "id": row.id,
        "message_id": row.message_id,
        "chat_id": row.chat_id,
        "payload": row.payload,
        "attempts": row.attempts,
    }


async def claim_batch(now: datetime) -> list[dict]:
    """Reclama trabajos listos, sin pasar por delante de otro pendiente del
    mismo chat (el orden de un chat se respeta) y sin chocar con otra réplica
    (``SKIP LOCKED``)."""
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
    async with session_scope() as session:
        jobs = (await session.execute(stmt)).scalars().all()
        claimed = []
        for job in jobs:
            job.status = OutboxStatus.PROCESSING
            job.updated_at = now
            claimed.append(_job(job))
        if claimed:
            await session.execute(
                update(WspMessage)
                .where(WspMessage.id.in_([job["message_id"] for job in claimed]))
                .values(outbox_status=MessageOutboxStatus.SENDING)
            )
    return claimed


async def stale_jobs(cutoff: datetime) -> list[dict]:
    """Trabajos que quedaron en ``processing`` porque el proceso murió a mitad
    de camino (crash, reinicio, OOM)."""
    async with session_scope() as session:
        rows = (await session.execute(
            select(
                MessageOutbox.id,
                MessageOutbox.message_id,
                MessageOutbox.chat_id,
                MessageOutbox.payload,
                MessageOutbox.attempts,
            ).where(MessageOutbox.status == OutboxStatus.PROCESSING, MessageOutbox.updated_at < cutoff)
        )).all()
    return [_job(row) for row in rows]
