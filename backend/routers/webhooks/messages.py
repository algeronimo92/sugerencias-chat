import logging

import base64
import binascii

from typing import Any
from fastapi import Body, HTTPException
from services.db_service import (
    fetch_message_by_wa_id,
    insert_message,
    mark_chat_read_from_whatsapp_receipt,
    mark_message_deleted,
    set_message_reaction,
    update_poll_results,
    update_message_content,
    update_message_content_from_secret,
    update_message_status,
)
from services.ad_referral_service import rehost_ad_thumbnail
from services.message_status_service import parse_message_status_events
from services.ws_manager import manager
from services.automation_service import trigger_inbound_message
from models.webhook_schemas import (
    NewMessageWebhookBody,
    ReactionWebhookBody,
    MessageEditedWebhookBody,
    MessageEditedSecretWebhookBody,
    PollResultsWebhookBody,
    MessageDeletedWebhookBody,
    SaveInboundMessageWebhookBody,
)
from routers.webhooks.common import _parse_iso_datetime, webhooks_router


router = webhooks_router()
logger = logging.getLogger(__name__)


@router.post("/messages")
async def new_message_webhook(body: NewMessageWebhookBody):
    """Llamado por n8n justo después de guardar un mensaje nuevo en la DB."""
    payload = {"type": "chats_updated", "reason": "inbound_message"}
    message = await fetch_message_by_wa_id(body.wa_message_id)
    if message is None:
        logger.warning(
            "Webhook de mensaje con wa_message_id desconocido: %s", body.wa_message_id
        )

    await rehost_ad_thumbnail(body.wa_message_id)

    if message is not None:
        payload["latest_message"] = message
        payload["chat_id"] = message["chat_id"]
        try:
            await trigger_inbound_message(message)
        except Exception:
            logger.exception("No se pudo programar la automatización del mensaje entrante")

    await manager.broadcast(payload)
    return {"status": "ok"}


@router.post("/reaction")
async def reaction_webhook(
    body: ReactionWebhookBody,
):
    """Llamado por n8n cuando entra una reacción. En vez de guardarla como un
    mensaje, la mergea sobre el mensaje objetivo (badge estilo WhatsApp) y avisa
    a los paneles para que repinten el hilo."""
    message = await set_message_reaction(
        body.chat_id, body.target_wa_message_id, body.emoji, body.from_me
    )
    # message es None cuando el reaccionado no está en nuestra base (histórico
    # anterior a la integración): no hay burbuja donde colgar el badge, se ignora.
    matched = message is not None
    if matched:
        await manager.broadcast(
            {"type": "chats_updated", "chat_id": body.chat_id, "reason": "reaction"}
        )
    return {"status": "ok", "matched": matched}


@router.post("/message-edited")
async def message_edited_webhook(
    body: MessageEditedWebhookBody,
):
    """Llamado por n8n cuando WhatsApp avisa que un mensaje se editó.

    Cubre lo que la app no originó: el cliente corrigiendo lo que escribió, o
    el vendedor editando desde el teléfono. La edición hecha desde el CRM ya
    guardó el texto nuevo al llamar a Evolution, así que este webhook la
    reescribe con el mismo valor y no cambia nada.
    """
    message = await update_message_content(body.chat_id, body.wa_message_id, body.text)
    # None cuando el editado no está en nuestra base (histórico anterior a la
    # integración) o ya fue eliminado: no hay burbuja que corregir.
    matched = message is not None
    if matched:
        await manager.broadcast(
            {"type": "chats_updated", "chat_id": body.chat_id, "reason": "message_edited"}
        )
    return {"status": "ok", "matched": matched}


@router.post("/message-edited-secret")
async def message_edited_secret_webhook(
    body: MessageEditedSecretWebhookBody,
):
    """Llamado por n8n cuando WhatsApp avisa una edición nativa como
    `secretEncryptedMessage` (protocolo cifrado desde ~mayo 2026, ver
    services/message_edit_crypto.py). Intenta descifrarla reusando el
    `message_secret` guardado del mensaje original.

    Un fallo de descifrado (secreto no guardado, ningún candidato de sender
    válido) es un resultado esperado, no un error de servidor: nunca 500,
    igual que el webhook hermano de texto plano.
    """
    try:
        enc_payload = base64.b64decode(body.enc_payload, validate=True)
        enc_iv = base64.b64decode(body.enc_iv, validate=True)
    except (binascii.Error, ValueError, UnicodeEncodeError):
        return {"status": "ok", "matched": False}

    message = await update_message_content_from_secret(
        body.chat_id, body.wa_message_id, body.sender_candidates, enc_payload, enc_iv
    )
    matched = message is not None
    if matched:
        await manager.broadcast(
            {"type": "chats_updated", "chat_id": body.chat_id, "reason": "message_edited"}
        )
    return {"status": "ok", "matched": matched}


@router.post("/poll-results")
async def poll_results_webhook(body: PollResultsWebhookBody):
    """Actualiza la encuesta original sin crear una burbuja para cada voto."""
    if not body.decrypted:
        # Un pollUpdateMessage crudo lleva opciones cifradas. Solo Evolution
        # puede descifrarlas; no se pisa un snapshot previo con una lista vacía.
        return {"status": "ok", "matched": False, "ignored": "encrypted_or_empty"}
    if body.mode == "delta" and not body.voter_id:
        return {"status": "ok", "matched": False, "ignored": "missing_voter"}
    message = await update_poll_results(
        body.chat_id,
        body.target_wa_message_id,
        body.results,
        voter_id=body.voter_id,
        mode=body.mode,
    )
    matched = message is not None
    if matched:
        await manager.broadcast(
            {"type": "chats_updated", "chat_id": body.chat_id, "reason": "poll_results"}
        )
    return {"status": "ok", "matched": matched}


@router.post("/message-deleted")
async def message_deleted_webhook(
    body: MessageDeletedWebhookBody,
):
    """Llamado por n8n cuando WhatsApp avisa que un mensaje se eliminó para
    todos. Mismo borrado lógico que hace la app al eliminar desde el CRM: la
    fila queda, el contenido deja de servirse y el hilo muestra la lápida."""
    message = await mark_message_deleted(body.chat_id, body.wa_message_id)
    matched = message is not None
    if matched:
        await manager.broadcast(
            {"type": "chats_updated", "chat_id": body.chat_id, "reason": "message_deleted"}
        )
    return {"status": "ok", "matched": matched}


@router.post("/message-status")
async def message_status_webhook(
    body: dict[str, Any] | list[dict[str, Any]] = Body(...),
):
    """Recibe un cambio de estado desde n8n o directamente desde Evolution.

    Acepta tanto ``{wa_message_id, status, from_me}`` como el evento nativo
    ``MESSAGES_UPDATE`` (incluidos lotes y estados numéricos 2–5). Cuando un
    mensaje del cliente llega como READ/PLAYED con ``from_me=false``, también
    sincroniza el contador interno de no leídos con WhatsApp Web.
    """
    events = parse_message_status_events(body)
    if not events:
        raise HTTPException(status_code=422, detail="No se encontró un ID y estado de mensaje válidos")

    changed = []
    read_synced = []
    for event in events:
        updated = await update_message_status(event.wa_message_id, event.status.value)
        if updated is not None:
            changed.append(updated)

        if event.from_me is False and event.status.value in {"READ", "PLAYED"}:
            read_update = await mark_chat_read_from_whatsapp_receipt(event.wa_message_id)
            if read_update is not None:
                read_synced.append(read_update)

    if changed or read_synced:
        read_synced_chat_ids = {item["chat_id"] for item in read_synced if item.get("chat_id")}
        chat_ids = {
            item["chat_id"]
            for item in [*changed, *read_synced]
            if item.get("chat_id")
        }
        if chat_ids:
            for chat_id in chat_ids:
                status_updates = [
                    {"id": item["id"], "status": item["status"]}
                    for item in changed
                    if item.get("chat_id") == chat_id
                ]
                # Si este chat tuvo un recibo de lectura nativo de WhatsApp,
                # last_read_at ya avanzó en la base: hay que avisarle al
                # frontend con "read" (igual que el POST /read manual) para
                # que refresque el badge, no con "message_status" (que solo
                # actualiza tiques y no invalida unread_count).
                reason = "read" if chat_id in read_synced_chat_ids else "message_status"
                await manager.broadcast(
                    {
                        "type": "chats_updated",
                        "chat_id": chat_id,
                        "reason": reason,
                        "message_statuses": status_updates,
                    }
                )
        else:
            await manager.broadcast({"type": "chats_updated", "reason": "message_status"})

    return {
        "status": "ok",
        "matched": bool(changed or read_synced),
        "received_count": len(events),
        "updated_count": len(changed),
        "read_count": len(read_synced),
    }


@router.post("/save-inbound-message")
async def save_inbound_message_webhook(body: SaveInboundMessageWebhookBody):
    """Reemplaza al nodo Postgres `guardar mensajes en posgress`: alta de un
    mensaje entrante. Un `wa_message_id` repetido (Evolution reenvía el mismo
    webhook sin confirmación) devuelve la fila ya existente en vez de romper,
    vía la misma lógica de `insert_message` que usa el resto de la app."""
    sent_at = _parse_iso_datetime(body.sent_at)

    message_secret: bytes | None = None
    if body.message_secret:
        try:
            message_secret = base64.b64decode(body.message_secret, validate=True)
        except (binascii.Error, ValueError):
            message_secret = None

    return await insert_message(
        body.chat_id,
        body.sender,
        body.content,
        media_url=body.media_url,
        wa_message_id=body.wa_message_id,
        status=body.status,
        message_type=body.message_type,
        analysis=body.analysis,
        payload=body.payload,
        message_secret=message_secret,
        sent_at=sent_at,
        quoted_wa_message_id=body.quoted_wa_message_id,
        media_width=body.media_width,
        media_height=body.media_height,
    )
