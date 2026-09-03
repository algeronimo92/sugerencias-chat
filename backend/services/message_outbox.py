import asyncio
import logging
from datetime import datetime, timedelta, timezone
from time import perf_counter

from sqlalchemy import exists, select, update
from sqlalchemy.orm import aliased

from db.models import MessageOutbox, ScheduledMessage, WspMessage
from db.session import get_sessionmaker
from services import db_service
from services.evolution_service import (
    EvolutionApiError,
    describe_send_failure,
    get_instance_capabilities,
    media_message_fields,
    send_whatsapp_buttons,
    send_whatsapp_list,
    send_whatsapp_location,
    send_whatsapp_media,
    send_whatsapp_sticker,
    send_whatsapp_template,
    send_whatsapp_text,
)
from services.media_storage import image_to_sticker_webp, read_media_base64, read_media_bytes
from services.productivity_service import complete_reply_tasks
from services.ws_manager import manager

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
WORKER_CONCURRENCY = 4
IDLE_POLL_SECONDS = 1.0

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


def _format_timestamp(value: datetime) -> str:
    return value.strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def _wa_message_id(response: dict) -> str | None:
    key = response.get("key") or {}
    return key.get("id") or response.get("messageId") or response.get("id")


async def enqueue_text_message(
    chat_id: str,
    text: str,
    reply_to: dict | None = None,
    *,
    actor_user_id: int | None = None,
) -> dict:
    return (await enqueue_messages(chat_id, [{
        "content": text,
        "payload": {"type": "text", "text": text},
        "reply_to": reply_to,
    }], actor_user_id=actor_user_id))[0]


# Tope del texto que se manda como vista previa de la cita. WhatsApp recorta
# igual del lado del cliente; el límite es solo para no inflar el payload.
QUOTED_PREVIEW_MAX = 300


def quoted_context(chat_id: str, target: dict) -> dict:
    """Contexto que Evolution necesita para que la cita se vea en WhatsApp.

    Es la forma de un mensaje de Baileys recortada al mínimo: la ``key``
    identifica el mensaje citado (``fromMe`` importa — sin él WhatsApp no
    encuentra el original) y ``message`` da el texto que se muestra dentro
    del recuadro de la cita.
    """
    return {
        "key": {
            "remoteJid": chat_id,
            "fromMe": target["sender"] == "vendedor",
            "id": target["wa_message_id"],
        },
        "message": {"conversation": (target.get("content") or "")[:QUOTED_PREVIEW_MAX]},
    }


def _outbound_message_fields(payload: dict) -> tuple[str, dict | None]:
    """Deriva (message_type, payload de wsp_messages) del payload de despacho.

    El payload de despacho (``MessageOutbox.payload``) es la instrucción de envío
    a Evolution; la columna ``payload`` de ``wsp_messages`` guarda solo lo que el
    frontend necesita para renderizar (lat/lon, filename…). Esto reemplaza a los
    pseudo-tags que antes se armaban en ``content`` en cada call site."""
    kind = payload.get("type")
    if kind == "media":
        return media_message_fields(payload["mediatype"], payload.get("filename"), payload.get("album_id"))
    if kind == "location":
        return "location", {"latitude": payload["latitude"], "longitude": payload["longitude"]}
    if kind == "official_template":
        return "template", {"name": payload.get("name"), "language": payload.get("language")}
    if kind == "interactive":
        return "interactive", {"interactive_type": payload.get("interactive_type")}
    if kind == "audio":
        return "audio", None
    if kind == "sticker":
        return "sticker", None
    if kind == "text":
        return "text", None
    return "unsupported", None


def _message_dict(message: WspMessage, reply_to: dict | None = None) -> dict:
    return {
        "id": message.id,
        "sender": message.sender,
        "content": message.content,
        "sent_at": _format_timestamp(message.sent_at),
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
    """
    if not items:
        return []
    now = datetime.now(timezone.utc)
    queued: list[tuple[WspMessage, dict | None]] = []
    async with get_sessionmaker()() as session:
        for position, item in enumerate(items):
            reply_to = item.get("reply_to")
            payload = item["payload"]
            if actor_user_id is not None:
                payload = {**payload, "_actor_user_id": actor_user_id}
            message_type, db_payload = _outbound_message_fields(payload)
            if item.get("forwarded"):
                db_payload = {**(db_payload or {}), "forwarded": True}
            if reply_to:
                payload = {**payload, "quoted": quoted_context(chat_id, reply_to)}
            message = WspMessage(
                chat_id=chat_id,
                sender="vendedor",
                content=item.get("content"),
                # IDs resuelven empates, pero microsegundos distintos también
                # mantienen el orden al mezclar mensajes en clientes antiguos.
                sent_at=now + timedelta(microseconds=position),
                media_url=item.get("media_url"),
                status="PENDING",
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
                status="pending",
                next_attempt_at=now,
            ))
            queued.append((message, reply_to))
        # actor_user_id solo viene poblado cuando el envío lo dispara un
        # vendedor logueado desde la app: eso cuenta como que un humano vio
        # la conversación. Sin actor_user_id es una automatización — no
        # implica que nadie del equipo haya visto el mensaje del cliente,
        # así que solo se registra como "atendido por bot" (ver
        # last_automated_reply_at en db_service._touch_automated_reply_stmt).
        stmt = (
            db_service._touch_last_read_stmt(chat_id, now)
            if actor_user_id is not None
            else db_service._touch_automated_reply_stmt(chat_id, now)
        )
        await session.execute(stmt)
        await session.commit()
    notify_new_work()
    return [_message_dict(message, reply_to) for message, reply_to in queued]


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
        job.status = "discarded"
        job.updated_at = now
        message.status = "DISCARDED"
        reply_to = await _quoted_message(session, chat_id, message.quoted_wa_message_id)
        await session.commit()
    await manager.broadcast({
        "type": "chats_updated",
        "chat_id": chat_id,
        "reason": "message_status",
        "message_statuses": [{"id": message_id, "status": "DISCARDED"}],
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
    actor_user_id = job["payload"].get("_actor_user_id")
    completed_tasks = 0
    if actor_user_id is not None:
        try:
            completed_tasks = await complete_reply_tasks(job["chat_id"], int(actor_user_id))
        except Exception:
            # El mensaje ya fue aceptado por WhatsApp y la outbox quedó en
            # sent. Un fallo secundario al cerrar tareas nunca debe convertirlo
            # en failed ni provocar que el worker lo envíe otra vez.
            logger.exception(
                "No se pudieron completar las tareas del lead %s tras responder",
                job["chat_id"],
            )
    await manager.broadcast({
        "type": "chats_updated",
        "chat_id": job["chat_id"],
        "reason": "outbound_message",
        "message_statuses": [{"id": job["message_id"], "status": "SERVER_ACK"}],
    })
    if completed_tasks:
        await manager.broadcast({"type": "tasks_updated"})
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
    error = describe_send_failure(exc, "enviar el mensaje a WhatsApp")[:2000]
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
    # Solo lo llevan los envíos que responden a un mensaje concreto. Las
    # plantillas oficiales e interactivas usan endpoints de Evolution que no
    # aceptan cita, así que ahí ni se guarda.
    quoted = payload.get("quoted")
    if kind == "text":
        return await send_whatsapp_text(chat_id, payload["text"], quoted=quoted), None
    if kind == "audio":
        # sendWhatsAppAudio (PTT) queda roto en esta instancia de Evolution
        # para la integración Meta Cloud API: acepta el envío (201, wamid
        # real) pero el mensaje nunca progresa ni un solo estado, ni siquiera
        # en el historial propio de Evolution — se confirmó comparando el
        # mismo audio (Ogg/Opus, byte a byte) mandado por los dos caminos, y
        # solo sendMedia lo entregó. mediatype "audio" pierde la burbuja
        # nativa de nota de voz (onda + reproducir) del lado del destinatario
        # y queda como adjunto reproducible normal, pero llega. fileName es
        # obligatorio acá: sin él Evolution devuelve 500 para audio.
        encoded = await asyncio.to_thread(read_media_base64, payload["media_url"])
        filename = payload["media_url"].rsplit("/", 1)[-1]
        return await send_whatsapp_media(chat_id, encoded, "audio", filename=filename, quoted=quoted), None
    if kind == "media":
        encoded = await asyncio.to_thread(read_media_base64, payload["media_url"])
        return await send_whatsapp_media(
            chat_id, encoded, payload["mediatype"],
            filename=payload.get("filename"), caption=payload.get("caption"), quoted=quoted,
        ), None
    if kind == "sticker":
        # sendSticker no acepta cita ni caption: solo el WEBP. Se reconvierte
        # acá (y no al encolar) porque el archivo original puede ser el que
        # subió el cliente, no un sticker ya normalizado.
        data = await asyncio.to_thread(read_media_bytes, payload["media_url"])
        encoded = await asyncio.to_thread(image_to_sticker_webp, data)
        return await send_whatsapp_sticker(chat_id, encoded), None
    if kind == "location":
        return await send_whatsapp_location(
            chat_id, payload["latitude"], payload["longitude"], quoted=quoted
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
    capabilities = await get_instance_capabilities()
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
        logger.warning("Evolution no pudo serializar una lista; se usa una alternativa de texto numerado")
        return await send_whatsapp_text(chat_id, fallback), fallback


async def _process_job(job: dict) -> None:
    started_at = perf_counter()
    try:
        payload = job["payload"]
        response, delivered_content = await _send_payload(job["chat_id"], payload)
        await _mark_sent(job, response, delivered_content)
        logger.info(
            "Mensaje %s del outbox (%s) enviado vía Evolution en %.0fms",
            job["message_id"], payload.get("type"),
            (perf_counter() - started_at) * 1000,
        )
    except asyncio.CancelledError:
        raise
    except Exception as exc:
        logger.warning("Falló el mensaje %s del outbox: %s", job["message_id"], exc)
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
            logger.exception("Error al procesar el outbox de mensajes")
        await _wait_for_work()
