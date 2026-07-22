from typing import Any

from fastapi import APIRouter, Body, Header, HTTPException
from services.db_service import (
    fetch_latest_message,
    mark_chat_read_from_whatsapp_receipt,
    update_message_status,
)
from services.message_status_service import parse_message_status_events
from services.settings_service import get_effective
from services.ws_manager import manager
from services.automation_service import trigger_inbound_message

import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])


async def _check_token(x_webhook_token: str | None) -> None:
    expected_token = await get_effective("inbound_webhook_token")
    if expected_token and x_webhook_token != expected_token:
        raise HTTPException(status_code=401, detail="Token inválido")


@router.post("/messages")
async def new_message_webhook(x_webhook_token: str | None = Header(default=None)):
    """Llamado por n8n justo después de guardar un mensaje nuevo en la DB."""
    await _check_token(x_webhook_token)

    payload = {"type": "chats_updated", "reason": "inbound_message"}
    latest = await fetch_latest_message()
    if latest is not None:
        payload["latest_message"] = latest
        payload["chat_id"] = latest["chat_id"]
        try:
            await trigger_inbound_message(latest)
        except Exception:
            logger.exception("No se pudo programar la automatización del mensaje entrante")

    await manager.broadcast(payload)
    return {"status": "ok"}


@router.post("/message-status")
async def message_status_webhook(
    body: dict[str, Any] | list[dict[str, Any]] = Body(...),
    x_webhook_token: str | None = Header(default=None),
):
    """Recibe un cambio de estado desde n8n o directamente desde Evolution.

    Acepta tanto ``{wa_message_id, status, from_me}`` como el evento nativo
    ``MESSAGES_UPDATE`` (incluidos lotes y estados numéricos 2–5). Cuando un
    mensaje del cliente llega como READ/PLAYED con ``from_me=false``, también
    sincroniza el contador interno de no leídos con WhatsApp Web.
    """
    await _check_token(x_webhook_token)

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
        chat_ids = {
            item["chat_id"]
            for item in [*changed, *read_synced]
            if item.get("chat_id")
        }
        if chat_ids:
            for chat_id in chat_ids:
                await manager.broadcast(
                    {"type": "chats_updated", "chat_id": chat_id, "reason": "message_status"}
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
