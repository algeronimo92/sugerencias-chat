import asyncio
import logging
from datetime import datetime, timedelta, timezone
from time import perf_counter

from sqlalchemy import exists, select, update
from sqlalchemy.orm import aliased

from db.models import MessageOutbox, ScheduledMessage, WspMessage
from db.session import get_sessionmaker
from services.evolution_service import (
    EvolutionApiError,
    get_template_capabilities,
    send_whatsapp_audio,
    send_whatsapp_buttons,
    send_whatsapp_list,
    send_whatsapp_location,
    send_whatsapp_media,
    send_whatsapp_template,
    send_whatsapp_text,
)
from services.media_storage import read_media_base64
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
    return (await enqueue_messages(chat_id, [{
        "content": text,
        "payload": {"type": "text", "text": text},
    }]))[0]


def _message_dict(message: WspMessage) -> dict:
    return {
        "id": message.id,
        "sender": message.sender,
        "content": message.content,
        "sent_at": _format_timestamp(message.sent_at),
        "media_url": message.media_url,
        "wa_message_id": message.wa_message_id,
        "status": message.status,
    }


async def enqueue_messages(chat_id: str, items: list[dict]) -> list[dict]:
    """Guarda uno o más mensajes y sus trabajos en una sola transacción.

    El payload contiene únicamente metadatos pequeños. Los archivos ya deben
    estar en el almacenamiento multimedia y se referencian por ``media_url``.
    """
    if not items:
        return []
    now = datetime.now(timezone.utc)
    messages: list[WspMessage] = []
    async with get_sessionmaker()() as session:
        for position, item in enumerate(items):
            message = WspMessage(
                chat_id=chat_id,
                sender="vendedor",
                content=item.get("content"),
                # IDs resuelven empates, pero microsegundos distintos también
                # mantienen el orden al mezclar mensajes en clientes antiguos.
                sent_at=now + timedelta(microseconds=position),
                media_url=item.get("media_url"),
                status="PENDING",
            )
            session.add(message)
            await session.flush()
            session.add(MessageOutbox(
                message_id=message.id,
                chat_id=chat_id,
                payload=item["payload"],
                status="pending",
                next_attempt_at=now,
            ))
            messages.append(message)
        await session.commit()
    return [_message_dict(message) for message in messages]


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
                MessageOutbox.status == "failed",
                WspMessage.status == "FAILED",
            )
            .with_for_update()
        )).scalar_one_or_none()
        if job is None:
            return None
        message = await session.get(WspMessage, message_id)
        if message is None:  # pragma: no cover - protegido por el JOIN
            return None
        job.status = "pending"
        job.attempts = 0
        job.next_attempt_at = now
        job.last_error = None
        job.updated_at = now
        message.status = "PENDING"
        message.wa_message_id = None
        await session.commit()
        return _message_dict(message)


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


async def _mark_sent(job: dict, response: dict, delivered_content: str | None = None) -> None:
    wa_id = _wa_message_id(response)
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        await session.execute(
            update(MessageOutbox)
            .where(MessageOutbox.id == job["id"])
            .values(status="sent", attempts=job["attempts"] + 1, last_error=None, updated_at=now)
        )
        message_values = {"wa_message_id": wa_id, "status": "SERVER_ACK"}
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
            .values(status="sent", error=None, updated_at=now)
        )
        await session.commit()
    await manager.broadcast({
        "type": "chats_updated",
        "chat_id": job["chat_id"],
        "reason": "outbound_message",
        "message_statuses": [{"id": job["message_id"], "status": "SERVER_ACK"}],
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
            "message_statuses": [{"id": job["message_id"], "status": "FAILED"}],
        })
        if scheduled_updated:
            await manager.broadcast({
                "type": "scheduled_messages_updated",
                "chat_id": job["chat_id"],
                "status": "failed",
            })


def _is_baileys_list_serialization_error(exc: Exception) -> bool:
    return "this.isZero is not a function" in str(exc)


def _list_text_fallback(title: str, description: str, footer: str, sections: list[dict]) -> str:
    lines: list[str] = []
    if title:
        lines.append(f"*{title}*")
    if description:
        lines.append(description)
    option_number = 1
    for section in sections:
        section_title = str(section.get("title") or "").strip()
        if section_title:
            lines.extend(["", f"*{section_title}*"])
        for row in section.get("rows", []):
            row_title = str(row.get("title") or "").strip()
            row_description = str(row.get("description") or "").strip()
            option = f"{option_number}. {row_title}"
            if row_description:
                option += f" — {row_description}"
            lines.append(option)
            option_number += 1
    lines.extend(["", "Responde con el número de la opción que deseas."])
    if footer:
        lines.extend(["", footer])
    return "\n".join(lines)


def _buttons_text_fallback(title: str, description: str, footer: str, buttons: list[dict]) -> str:
    lines = [f"*{title}*", description, ""]
    reply_only = all(button.get("type") == "reply" for button in buttons)
    for index, button in enumerate(buttons, start=1):
        label = str(button.get("displayText") or "").strip()
        button_type = button.get("type")
        if button_type == "reply":
            lines.append(f"{index}. {label}")
        elif button_type == "url":
            lines.append(f"• {label}: {button.get('url', '')}")
        elif button_type == "call":
            lines.append(f"• {label}: {button.get('phoneNumber', '')}")
        else:
            lines.append(f"• {label}: {button.get('copyCode', '')}")
    if reply_only:
        lines.extend(["", "Responde con el número de la opción que deseas."])
    if footer:
        lines.extend(["", footer])
    return "\n".join(lines)


async def _send_payload(chat_id: str, payload: dict) -> tuple[dict, str | None]:
    """Envía un payload de outbox y devuelve la respuesta y, si cambió por
    un fallback compatible, el contenido realmente entregado."""
    kind = payload.get("type")
    if kind == "text":
        return await send_whatsapp_text(chat_id, payload["text"]), None
    if kind == "audio":
        encoded = await asyncio.to_thread(read_media_base64, payload["media_url"])
        return await send_whatsapp_audio(chat_id, encoded), None
    if kind == "media":
        encoded = await asyncio.to_thread(read_media_base64, payload["media_url"])
        return await send_whatsapp_media(
            chat_id, encoded, payload["mediatype"], filename=payload.get("filename")
        ), None
    if kind == "location":
        return await send_whatsapp_location(
            chat_id, payload["latitude"], payload["longitude"]
        ), None
    if kind == "official_template":
        return await send_whatsapp_template(
            chat_id, payload["name"], payload["language"], payload.get("components", [])
        ), None
    if kind != "interactive":
        raise ValueError(f"Tipo de outbox no soportado: {kind}")

    interactive_type = payload["interactive_type"]
    description = payload["description"]
    config = payload["config"]
    capabilities = await get_template_capabilities()
    if capabilities.get("integration") != "WHATSAPP-BUSINESS":
        if interactive_type == "buttons":
            fallback = _buttons_text_fallback(
                config["title"], description,
                config.get("footer") or "DermicaPro", config["buttons"],
            )
        else:
            fallback = _list_text_fallback(
                config["title"], description,
                config.get("footerText") or "DermicaPro", config["sections"],
            )
        return await send_whatsapp_text(chat_id, fallback), fallback

    if interactive_type == "buttons":
        response = await send_whatsapp_buttons(
            chat_id, config["title"], description,
            config.get("footer") or "DermicaPro", config["buttons"],
        )
        return response, None
    try:
        response = await send_whatsapp_list(
            chat_id, config["title"], description,
            config.get("footerText") or "DermicaPro",
            config["buttonText"], config["sections"],
        )
        return response, None
    except EvolutionApiError as exc:
        if not _is_baileys_list_serialization_error(exc):
            raise
        fallback = _list_text_fallback(
            config["title"], description,
            config.get("footerText") or "DermicaPro", config["sections"],
        )
        logger.warning("Evolution could not serialize a list; using numbered text fallback")
        return await send_whatsapp_text(chat_id, fallback), fallback


async def _process_job(job: dict) -> None:
    started_at = perf_counter()
    try:
        payload = job["payload"]
        response, delivered_content = await _send_payload(job["chat_id"], payload)
        await _mark_sent(job, response, delivered_content)
        logger.info(
            "Outbox %s message %s sent via Evolution in %.0fms",
            payload.get("type"), job["message_id"],
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
