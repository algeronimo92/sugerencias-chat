import asyncio
import logging
from datetime import datetime, timedelta, timezone
from time import perf_counter

from sqlalchemy import exists, select, update
from sqlalchemy.orm import aliased

from db.models import MessageOutbox, ScheduledMessage, WspMessage
from db.session import get_sessionmaker
from services.evolution_service import send_whatsapp_text
from services.ws_manager import manager

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
WORKER_CONCURRENCY = 4
IDLE_POLL_SECONDS = 1.0


def _format_timestamp(value: datetime) -> str:
    return value.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _wa_message_id(response: dict) -> str | None:
    key = response.get("key") or {}
    return key.get("id") or response.get("messageId") or response.get("id")


async def enqueue_text_message(chat_id: str, text: str) -> dict:
    """Guarda mensaje + trabajo de envío en la misma transacción."""
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        message = WspMessage(
            chat_id=chat_id,
            sender="vendedor",
            content=text,
            sent_at=now,
            status="PENDING",
        )
        session.add(message)
        await session.flush()
        session.add(MessageOutbox(
            message_id=message.id,
            chat_id=chat_id,
            payload={"type": "text", "text": text},
            status="pending",
            next_attempt_at=now,
        ))
        await session.commit()

    return {
        "id": message.id,
        "sender": message.sender,
        "content": message.content,
        "sent_at": _format_timestamp(message.sent_at),
        "media_url": message.media_url,
        "wa_message_id": message.wa_message_id,
        "status": message.status,
    }


async def _recover_stale_jobs() -> None:
    cutoff = datetime.now(timezone.utc) - timedelta(minutes=5)
    async with get_sessionmaker()() as session:
        await session.execute(
            update(MessageOutbox)
            .where(MessageOutbox.status == "processing", MessageOutbox.updated_at < cutoff)
            .values(status="pending", next_attempt_at=datetime.now(timezone.utc))
        )
        await session.commit()


async def _claim_batch() -> list[dict]:
    now = datetime.now(timezone.utc)
    earlier = aliased(MessageOutbox)
    has_earlier_unsent = exists(
        select(earlier.id).where(
            earlier.chat_id == MessageOutbox.chat_id,
            earlier.id < MessageOutbox.id,
            earlier.status.in_(("pending", "processing")),
        )
    )
    stmt = (
        select(MessageOutbox)
        .where(
            MessageOutbox.status == "pending",
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
            job.status = "processing"
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


async def _mark_sent(job: dict, response: dict) -> None:
    wa_id = _wa_message_id(response)
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        await session.execute(
            update(MessageOutbox)
            .where(MessageOutbox.id == job["id"])
            .values(status="sent", attempts=job["attempts"] + 1, last_error=None, updated_at=now)
        )
        await session.execute(
            update(WspMessage)
            .where(WspMessage.id == job["message_id"])
            .values(wa_message_id=wa_id, status="SERVER_ACK")
        )
        scheduled_result = await session.execute(
            update(ScheduledMessage)
            .where(ScheduledMessage.queued_message_id == job["message_id"])
            .values(status="sent", error=None, updated_at=now)
        )
        await session.commit()
    await manager.broadcast({
        "type": "chats_updated",
        "chat_id": job["chat_id"],
        "reason": "outbound_message",
    })
    if scheduled_result.rowcount:
        await manager.broadcast({
            "type": "scheduled_messages_updated",
            "chat_id": job["chat_id"],
            "status": "sent",
        })


async def _mark_failed(job: dict, exc: Exception) -> None:
    attempts = job["attempts"] + 1
    exhausted = attempts >= MAX_ATTEMPTS
    now = datetime.now(timezone.utc)
    delay = timedelta(seconds=2 ** attempts)
    error = str(exc)[:2000]
    scheduled_updated = False
    async with get_sessionmaker()() as session:
        await session.execute(
            update(MessageOutbox)
            .where(MessageOutbox.id == job["id"])
            .values(
                status="failed" if exhausted else "pending",
                attempts=attempts,
                next_attempt_at=now + delay,
                last_error=error,
                updated_at=now,
            )
        )
        if exhausted:
            await session.execute(
                update(WspMessage)
                .where(WspMessage.id == job["message_id"])
                .values(status="FAILED")
            )
            scheduled_result = await session.execute(
                update(ScheduledMessage)
                .where(ScheduledMessage.queued_message_id == job["message_id"])
                .values(status="failed", error=error, updated_at=now)
            )
            scheduled_updated = bool(scheduled_result.rowcount)
        await session.commit()
    if exhausted:
        await manager.broadcast({
            "type": "chats_updated",
            "chat_id": job["chat_id"],
            "reason": "message_status",
        })
        if scheduled_updated:
            await manager.broadcast({
                "type": "scheduled_messages_updated",
                "chat_id": job["chat_id"],
                "status": "failed",
            })


async def _process_job(job: dict) -> None:
    started_at = perf_counter()
    try:
        payload = job["payload"]
        if payload.get("type") != "text":
            raise ValueError(f"Tipo de outbox no soportado: {payload.get('type')}")
        response = await send_whatsapp_text(job["chat_id"], payload["text"])
        await _mark_sent(job, response)
        logger.info(
            "Outbox message %s sent via Evolution in %.0fms",
            job["message_id"],
            (perf_counter() - started_at) * 1000,
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("Outbox message %s failed: %s", job["message_id"], exc)
        await _mark_failed(job, exc)


async def watch_message_outbox() -> None:
    await _recover_stale_jobs()
    while True:
        try:
            jobs = await _claim_batch()
            if jobs:
                await asyncio.gather(*(_process_job(job) for job in jobs))
                continue
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error processing message outbox")
        await asyncio.sleep(IDLE_POLL_SECONDS)
