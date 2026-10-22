"""Worker del outbox: manda por el canal lo que la aplicación encoló.

Es un adaptador de entrada: reclama trabajos, completa el cuerpo con lo que
solo se sabe al enviar (los adjuntos se suben a Meta recién acá: un id subido
al encolar podría vencer mientras el trabajo espera), llama al canal y registra
el resultado con ``record_sent``/``record_failed``. Los avisos y las tareas que
se completan al responder los resuelven los suscriptores de esos eventos.
"""

from __future__ import annotations

import asyncio

from app.db.signals import ring, signal
from app.tenancy.context import get_current_tenant
import contextlib
import copy
import logging
from collections.abc import Callable
from datetime import datetime, timedelta, timezone
from time import monotonic, perf_counter

from app.integrations.meta.outbound import OutboundRejected, require_capabilities, validate_message
from app.integrations.meta_webhook import metrics
from app.integrations.storage.media_storage import (
    MediaNotFoundError,
    image_to_sticker_webp,
    read_media_bytes,
    stat_media,
)
from app.integrations.whatsapp.channel import (
    ChannelError,
    DeliveryUnconfirmedError,
    SendReceipt,
    describe_send_failure,
)
from app.integrations.whatsapp.channels import current_channel
from app.integrations.whatsapp.identity import WA_ID, add_identity_alias
from app.modules.conversations.application.outbound import record_failed, record_sent
from app.modules.conversations.domain.delivery import SendOutcome
from app.modules.conversations.infrastructure.sql_outbox import claim_batch, stale_jobs

logger = logging.getLogger(__name__)

IDLE_POLL_SECONDS = 1.0
STALE_PROCESSING_AFTER = timedelta(minutes=5)
STALE_SWEEP_INTERVAL_SECONDS = 60.0
SHUTDOWN_GRACE_SECONDS = 8.0
RECORD_SENT_RETRY_DELAYS = (0.0, 0.5, 1.0, 2.0, 4.0)
# Cada tanda se procesa con ``asyncio.gather``: un solo trabajo colgado (sin
# excepción ni timeout propio) nunca dejaría terminarla y todo el outbox
# quedaría congelado. Distinto del barrido de trabajos huérfanos, que cubre un
# proceso que murió.
JOB_TIMEOUT_SECONDS = 90


def _rejection_outcome(exc: ChannelError) -> SendOutcome:
    if exc.status_code is not None and (exc.status_code == 429 or exc.status_code >= 500):
        return SendOutcome.RETRYABLE
    return SendOutcome.DEFINITIVE


# Cómo se traduce cada error del canal a la política de entrega del dominio.
SEND_FAILURE_OUTCOMES: tuple[tuple[type[Exception], Callable[[Exception], SendOutcome]], ...] = (
    (DeliveryUnconfirmedError, lambda _exc: SendOutcome.UNCONFIRMED),
    (ChannelError, _rejection_outcome),
    (OutboundRejected, lambda _exc: SendOutcome.DEFINITIVE),
    (MediaNotFoundError, lambda _exc: SendOutcome.DEFINITIVE),
    (KeyError, lambda _exc: SendOutcome.DEFINITIVE),
    (ValueError, lambda _exc: SendOutcome.DEFINITIVE),
)


def classify_send_failure(exc: Exception) -> SendOutcome:
    for exc_type, outcome in SEND_FAILURE_OUTCOMES:
        if isinstance(exc, exc_type):
            return outcome(exc)
    return SendOutcome.RETRYABLE


def describe_failure(exc: Exception) -> str:
    if isinstance(exc, OutboundRejected):
        metrics.outbound_rejected.labels(reason=exc.reason).inc()
        return str(exc)
    return describe_send_failure(exc, "enviar el mensaje a WhatsApp")


# Despierta al worker en cuanto hay trabajo nuevo, en lugar de esperar el
# próximo sondeo, aunque el mensaje se haya encolado en otro proceso (la API)
# que el worker. El sondeo queda como respaldo.
OUTBOX_SIGNAL = "outbox"


async def notify_new_work() -> None:
    await ring(OUTBOX_SIGNAL)


async def _wait_for_work() -> None:
    await signal(OUTBOX_SIGNAL).wait(IDLE_POLL_SECONDS)


async def _upload_stored_media(media: dict) -> str:
    info = await asyncio.to_thread(stat_media, media["media_url"])
    content = await asyncio.to_thread(read_media_bytes, media["media_url"])
    content_type = info.content_type
    filename = media.get("filename") or media["media_url"].rsplit("/", 1)[-1]
    if media.get("as_sticker"):
        content = await asyncio.to_thread(image_to_sticker_webp, content)
        content_type = "image/webp"
    return await current_channel().sender.upload_media(content, content_type, filename)


async def build_final_message(job_payload: dict) -> dict:
    """Completa el cuerpo guardado con lo que solo se sabe al enviar. Un
    trabajo sin ``message`` es de un formato anterior y no se envía."""
    if not isinstance(job_payload.get("message"), dict):
        raise OutboundRejected("El trabajo del outbox no tiene un cuerpo Meta", reason="legacy_job")
    message = copy.deepcopy(job_payload["message"])
    validate_message(message)
    media = job_payload.get("media")
    if media:
        root = message["type"]
        message[root] = {**message.get(root, {}), "id": await _upload_stored_media(media)}
    header_media = job_payload.get("header_media")
    if header_media:
        media_id = await _upload_stored_media(header_media)
        template = message["template"]
        template["components"] = [
            {"type": "header", "parameters": [{"type": "image", "image": {"id": media_id}}]},
            *(template.get("components") or []),
        ]
    validate_message(message, final=True)
    await require_capabilities(message)
    return message


def _payload_matches(stored: dict, sent: dict) -> bool:
    """El cuerpo enviado debe ser el guardado más lo que se completa al enviar:
    el sobre (destinatario), el id del adjunto y el encabezado de la plantilla."""
    envelope = {"messaging_product", "recipient_type", "to"}
    sent_message = {key: value for key, value in sent.items() if key not in envelope}
    root = sent_message.get("type")
    nested = sent_message.get(root)
    if isinstance(nested, dict) and "id" in nested and "id" not in (stored.get(root) or {}):
        sent_message[root] = {key: value for key, value in nested.items() if key != "id"}
    if root == "template":
        stored_components = stored["template"].get("components") or []
        sent_components = sent_message["template"].get("components") or []
        if len(sent_components) == len(stored_components) + 1 and sent_components[0].get("type") == "header":
            template = {**sent_message["template"]}
            if sent_components[1:]:
                template["components"] = sent_components[1:]
            else:
                template.pop("components", None)
            sent_message["template"] = template
    return sent_message == stored


async def _persist_sent(job: dict, receipt: SendReceipt) -> bool:
    """WhatsApp ya aceptó el mensaje: registrarlo se reintenta, porque perderlo
    dejaría al vendedor viendo "no enviado" algo que el cliente recibió."""
    for delay in RECORD_SENT_RETRY_DELAYS:
        await asyncio.sleep(delay)
        try:
            await record_sent(job, receipt)
        except Exception:
            logger.warning(
                "WhatsApp aceptó el mensaje %s pero no se pudo registrar como enviado",
                job["message_id"], exc_info=True,
            )
            continue
        return True
    logger.error("El mensaje %s salió hacia WhatsApp y no quedó registrado como enviado", job["message_id"])
    return False


async def _mark_failed(job: dict, exc: Exception, outcome: SendOutcome) -> None:
    await record_failed(job, error=describe_failure(exc), outcome=outcome)


async def _learn_recipient(job: dict, receipt: SendReceipt) -> None:
    """Si Meta informa otro ``wa_id`` para el destinatario (por ejemplo, un
    número con formato local que Meta normaliza), se suma como alias."""
    to = receipt.sent_body.get("to")
    if receipt.recipient_wa_id and receipt.recipient_wa_id != to:
        with contextlib.suppress(Exception):
            await add_identity_alias(job["chat_id"], "", WA_ID, receipt.recipient_wa_id)


async def _process_job(job: dict) -> None:
    started_at = perf_counter()
    payload = job["payload"]
    try:
        message = await build_final_message(payload)
        receipt = await asyncio.wait_for(
            current_channel().sender.send(job["chat_id"], message),
            timeout=JOB_TIMEOUT_SECONDS,
        )
    except asyncio.CancelledError:
        await asyncio.shield(_mark_failed(job, DeliveryUnconfirmedError(), SendOutcome.UNCONFIRMED))
        raise
    except Exception as exc:
        outcome = classify_send_failure(exc)
        logger.warning("Falló el mensaje %s del outbox (%s): %s", job["message_id"], outcome, exc)
        await _mark_failed(job, exc, outcome)
        return
    if not _payload_matches(payload["message"], receipt.sent_body):
        metrics.outbound_payload_mismatch.inc()
        logger.warning("El cuerpo enviado del mensaje %s difiere del registrado en el outbox", job["message_id"])
    logger.info(
        "Mensaje %s del outbox (%s) enviado vía Meta en %.0fms",
        job["message_id"], payload["message"].get("type"), (perf_counter() - started_at) * 1000,
    )
    await asyncio.shield(_persist_sent(job, receipt))
    await _learn_recipient(job, receipt)


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


async def _recover_stale_jobs() -> None:
    """Un trabajo huérfano no se reintenta a ciegas: puede haber salido ya."""
    for job in await stale_jobs(datetime.now(timezone.utc) - STALE_PROCESSING_AFTER):
        logger.warning(
            "El mensaje %s del outbox quedó en processing sin terminar; se marca sin confirmar",
            job["message_id"],
        )
        await _mark_failed(job, DeliveryUnconfirmedError(), SendOutcome.UNCONFIRMED)


# Cuándo le toca a cada negocio el barrido de trabajos huérfanos.
_next_sweep_at: dict[object, float] = {}


async def outbox_tick() -> bool:
    """Una pasada para el negocio en curso: un lote de envíos. True si tomó
    un lote, para que el ciclo vuelva sin esperar."""
    context = get_current_tenant()
    key = context.organization_id if context else None
    if monotonic() >= _next_sweep_at.get(key, 0.0):
        _next_sweep_at[key] = monotonic() + STALE_SWEEP_INTERVAL_SECONDS
        await _recover_stale_jobs()
    jobs = await claim_batch(datetime.now(timezone.utc))
    if jobs:
        await _process_batch(jobs)
    return bool(jobs)


async def wait_for_outbox_work() -> None:
    await _wait_for_work()


def forget_outbox(key: object) -> None:
    _next_sweep_at.pop(key, None)
