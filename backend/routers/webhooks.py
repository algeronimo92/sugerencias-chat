from typing import Any

from fastapi import APIRouter, Body, Header, HTTPException
from services.db_service import fetch_latest_message, update_message_status
from services.message_status_service import parse_message_status_updates
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

    payload = {"type": "chats_updated"}
    latest = await fetch_latest_message()
    if latest is not None:
        payload["latest_message"] = latest
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

    Acepta tanto ``{wa_message_id, status}`` como el evento nativo
    ``MESSAGES_UPDATE`` (incluidos lotes y estados numéricos 2–5).
    """
    await _check_token(x_webhook_token)

    updates = parse_message_status_updates(body)
    if not updates:
        raise HTTPException(status_code=422, detail="No se encontró un ID y estado de mensaje válidos")

    changed = []
    for wa_message_id, status in updates:
        updated = await update_message_status(wa_message_id, status.value)
        if updated is not None:
            changed.append(updated)

    if changed:
        await manager.broadcast({"type": "chats_updated"})

    return {
        "status": "ok",
        "matched": bool(changed),
        "received_count": len(updates),
        "updated_count": len(changed),
    }
