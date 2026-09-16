import logging

import httpx

from datetime import datetime, timedelta, timezone
from fastapi import Depends, HTTPException
from db.models import User
from models.schemas import EditMessageRequest, Message, PinnedMessagesResponse, ReactionRequest
from services.db_service import (
    fetch_pinned_messages,
    fetch_reply_target,
    mark_message_deleted,
    MAX_PINNED_MESSAGES,
    pin_message,
    PinLimitReachedError,
    set_message_reaction,
    unpin_message,
    update_message_content,
)
from services.auth_service import get_current_user
from services.whatsapp_capabilities import EDIT_DELETE_UNSUPPORTED_DETAIL
from services.whatsapp_channel import (
    ChannelError,
    MessageEditor,
    ReactionTarget,
    describe_send_failure,
)
from services.whatsapp_channels import current_channel
from services.ws_manager import manager
from routers.chats.common import chats_router


router = chats_router()
logger = logging.getLogger(__name__)


@router.post("/{chat_id}/messages/{message_id}/reaction", response_model=Message)
async def react_to_message(chat_id: str, message_id: int, body: ReactionRequest):
    """Reacciona (o quita la reacción) del vendedor sobre un mensaje del chat.

    Manda primero a WhatsApp y recién si eso funciona persiste el badge: una
    reacción que solo se viera de nuestro lado engañaría al vendedor haciéndole
    creer que el cliente la vio."""
    target = await fetch_reply_target(chat_id, message_id)
    if target is None:
        raise HTTPException(404, "El mensaje no existe en este chat")
    if not target["wa_message_id"]:
        # Un mensaje del vendedor todavía en la outbox no tiene id de WhatsApp:
        # no se le puede reaccionar hasta que se confirme el envío.
        raise HTTPException(409, "El mensaje todavía no está confirmado en WhatsApp")

    reaction_target = ReactionTarget(
        chat_id=chat_id,
        provider_message_id=target["wa_message_id"],
        from_me=target["sender"] == "vendedor",
    )
    try:
        await current_channel().actions.react(reaction_target, body.emoji)
    except (ChannelError, httpx.HTTPError) as exc:
        logger.warning("No se pudo enviar la reacción a WhatsApp para %s: %s", chat_id, exc)
        raise HTTPException(502, describe_send_failure(exc, "enviar la reacción a WhatsApp"))

    message = await set_message_reaction(chat_id, target["wa_message_id"], body.emoji, from_me=True)
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "reaction"})
    return message


def _require_editor() -> MessageEditor:
    editor = current_channel().editor
    if editor is None:
        raise HTTPException(status_code=409, detail=EDIT_DELETE_UNSUPPORTED_DETAIL)
    return editor


# WhatsApp deja reescribir un mensaje propio de texto solo dentro de esta
# ventana. Se comprueba acá para poder explicarlo: pasado el límite Evolution
# acepta el pedido pero WhatsApp lo descarta en silencio, y el vendedor se
# quedaría creyendo que corrigió algo que el cliente sigue viendo como estaba.
EDIT_MESSAGE_WINDOW = timedelta(minutes=15)


def _editable_or_deletable_target(target: dict | None, action: str) -> dict:
    """Comprobaciones que comparten editar y eliminar.

    WhatsApp solo permite las dos cosas sobre mensajes propios y ya
    confirmados; de un mensaje del cliente no se puede tocar nada (el "eliminar
    para todos" ajeno no existe fuera de los grupos, y ahí solo para admins).
    """
    if target is None:
        raise HTTPException(404, "El mensaje no existe en este chat")
    if target["deleted_at"] is not None:
        raise HTTPException(409, "El mensaje ya fue eliminado")
    if target["sender"] != "vendedor":
        raise HTTPException(409, f"WhatsApp solo permite {action} los mensajes que enviaste vos")
    if not target["wa_message_id"]:
        # Un mensaje del vendedor todavía en la outbox no tiene id de WhatsApp:
        # no existe del otro lado como para editarlo o borrarlo.
        raise HTTPException(409, "El mensaje todavía no está confirmado en WhatsApp")
    return target


@router.patch("/{chat_id}/messages/{message_id}", response_model=Message)
async def edit_message(chat_id: str, message_id: int, body: EditMessageRequest):
    """Reescribe el texto de un mensaje ya enviado, como el "Editar" de WhatsApp.

    Igual que las reacciones: primero WhatsApp y recién después la base. Un
    texto corregido solo de nuestro lado sería peor que no corregirlo — el
    vendedor daría por hecho que el cliente ve la versión nueva.
    """
    editor = _require_editor()
    target = _editable_or_deletable_target(
        await fetch_reply_target(chat_id, message_id), "editar"
    )
    if target["message_type"] not in (None, "text"):
        raise HTTPException(409, "WhatsApp solo permite editar mensajes de texto")
    sent_at = target["sent_at"]
    if sent_at is not None and datetime.now(timezone.utc) - sent_at > EDIT_MESSAGE_WINDOW:
        raise HTTPException(
            409,
            "WhatsApp solo permite editar un mensaje dentro de los 15 minutos posteriores al envío",
        )

    text = body.text.strip()
    if not text:
        raise HTTPException(400, "El texto del mensaje no puede quedar vacío")

    try:
        await editor.edit(chat_id, target["wa_message_id"], text)
    except (ChannelError, httpx.HTTPError) as exc:
        logger.warning("No se pudo editar el mensaje en WhatsApp para %s: %s", chat_id, exc)
        raise HTTPException(502, describe_send_failure(exc, "editar el mensaje en WhatsApp"))

    message = await update_message_content(chat_id, target["wa_message_id"], text)
    if message is None:
        raise HTTPException(404, "El mensaje no existe en este chat")
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "message_edited"})
    return message


@router.delete("/{chat_id}/messages/{message_id}", response_model=Message)
async def delete_message(chat_id: str, message_id: int):
    """Elimina para todos un mensaje ya enviado.

    No borra la fila: la marca como eliminada y deja de servir su contenido
    (ver mark_message_deleted). El CRM conserva que hubo un mensaje ahí —el
    hilo muestra la lápida, como WhatsApp— sin exponer lo que decía.
    """
    editor = _require_editor()
    target = _editable_or_deletable_target(
        await fetch_reply_target(chat_id, message_id), "eliminar"
    )

    try:
        await editor.delete(chat_id, target["wa_message_id"])
    except (ChannelError, httpx.HTTPError) as exc:
        logger.warning("No se pudo eliminar el mensaje en WhatsApp para %s: %s", chat_id, exc)
        raise HTTPException(502, describe_send_failure(exc, "eliminar el mensaje en WhatsApp"))

    message = await mark_message_deleted(chat_id, target["wa_message_id"])
    if message is None:
        raise HTTPException(404, "El mensaje no existe en este chat")
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "message_deleted"})
    return message


@router.get("/{chat_id}/pinned-messages", response_model=PinnedMessagesResponse)
async def get_pinned_messages(chat_id: str):
    return {"items": await fetch_pinned_messages(chat_id)}


@router.post("/{chat_id}/messages/{message_id}/pin", response_model=Message)
async def pin_chat_message(chat_id: str, message_id: int, user: User = Depends(get_current_user)):
    """Fija un mensaje, como el "Fijar" de WhatsApp — pero solo dentro del CRM:
    ni Evolution API ni Baileys exponen forma de fijar un mensaje del lado de
    quien envía, así que esto no se refleja en el WhatsApp del cliente."""
    try:
        message = await pin_message(chat_id, message_id, user.id)
    except PinLimitReachedError:
        raise HTTPException(
            409, f"Ya hay {MAX_PINNED_MESSAGES} mensajes fijados en este chat. Desfijá uno primero."
        )
    if message is None:
        raise HTTPException(404, "El mensaje no existe en este chat")
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "message_pinned"})
    return message


@router.post("/{chat_id}/messages/{message_id}/unpin", response_model=Message)
async def unpin_chat_message(chat_id: str, message_id: int):
    message = await unpin_message(chat_id, message_id)
    if message is None:
        raise HTTPException(404, "El mensaje no existe en este chat")
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "message_pinned"})
    return message
