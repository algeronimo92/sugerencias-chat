"""Casos de uso de la entrada: lo que Meta informa por el webhook.

El procesador del webhook (``app.integrations.meta_webhook.processor``) es el
adaptador: traduce el JSON de Meta y llama a estos comandos. Cada uno guarda
en una transacción y publica un evento; avisar a los paneles, disparar
automatizaciones o completar tareas lo hacen los suscriptores.
"""

from __future__ import annotations

from datetime import datetime, timezone

from app.db.uow import collect, unit_of_work
from app.modules.conversations.application.ports import conversation_ports
from app.modules.conversations.domain.events import (
    MessageMediaReady,
    MessageStatusChanged,
    ProviderMessageStored,
    ReactionChanged,
)

# Raíces de Meta que no son mensajes del cliente ni del negocio.
NON_CONVERSATIONAL_TYPES = frozenset({"system"})


def _now() -> datetime:
    return datetime.now(timezone.utc)


async def receive_provider_message(
    *,
    chat_id: str,
    sender: str,
    wa_message_id: str,
    message_type: str | None,
    message_subtype: str | None,
    provider_payload: dict,
    content: str | None,
    sent_at: datetime | None,
    quoted_wa_message_id: str | None,
    webhook_event_id: str | None,
    payload: dict | None = None,
    human_outbound: bool | None = None,
) -> tuple[dict, bool]:
    """Guarda el mensaje si no existe. Devuelve ``(mensaje, creado)``.

    ``wa_message_id`` es único: un reintento de Meta encuentra la fila ya
    guardada y no la duplica ni la modifica.
    """
    ports = conversation_ports()
    async with unit_of_work():
        stored, created = await ports.messages.insert_provider_message(
            chat_id=chat_id, sender=sender, wa_message_id=wa_message_id,
            message_type=message_type, message_subtype=message_subtype,
            provider_payload=provider_payload, content=content, sent_at=sent_at,
            quoted_wa_message_id=quoted_wa_message_id, webhook_event_id=webhook_event_id,
            payload=payload,
        )
        if created:
            now = _now()
            if sender == "vendedor":
                # Un eco desde el teléfono del vendedor cuenta como que un
                # humano atendió; uno marcado como automático, no.
                if human_outbound is False:
                    await ports.inbox.touch_automated_reply(chat_id, now)
                else:
                    await ports.inbox.touch_human_reply(chat_id, now)
            await ports.inbox.touch_last_message(chat_id, now)
            collect(ProviderMessageStored(
                chat_id=chat_id, message_id=stored["id"], wa_message_id=wa_message_id,
                inbound=sender == "cliente",
                conversational=message_type not in NON_CONVERSATIONAL_TYPES,
            ))
    return stored, created


async def record_provider_status(
    status: dict,
    *,
    occurred_at: datetime | None,
    webhook_event_id: str | None,
) -> dict | None:
    """Guarda un ``statuses[]`` de Meta y recalcula el estado del mensaje."""
    async with unit_of_work():
        update = await conversation_ports().messages.record_status_event(
            status, occurred_at=occurred_at, webhook_event_id=webhook_event_id,
        )
        if update is not None:
            collect(MessageStatusChanged(
                chat_id=update["chat_id"], message_id=update["id"], meta_status=update["meta_status"],
            ))
    return update


async def record_provider_reaction(
    *,
    event_wa_id: str | None,
    target_wa_message_id: str,
    chat_id: str | None,
    emoji: str,
    actor: str,
    provider_payload: dict,
    occurred_at: datetime | None,
    webhook_event_id: str | None,
) -> bool:
    """Guarda la reacción como evento y actualiza el badge del mensaje. False
    si ya estaba (reintento de Meta)."""
    messages = conversation_ports().messages
    async with unit_of_work():
        recorded = await messages.record_reaction_event(
            event_wa_id=event_wa_id, target_wa_message_id=target_wa_message_id, chat_id=chat_id,
            emoji=emoji, actor=actor, provider_payload=provider_payload,
            occurred_at=occurred_at, webhook_event_id=webhook_event_id,
        )
        if not recorded or chat_id is None:
            return recorded
        updated = await messages.apply_reaction(
            chat_id, target_wa_message_id, emoji, from_me=actor == "business",
        )
        if updated is not None:
            collect(ReactionChanged(chat_id=chat_id))
    return recorded


async def attach_media(chat_id: str, message_id: int, media_url: str) -> None:
    """El adjunto de un mensaje entrante ya está en el almacenamiento propio."""
    async with unit_of_work():
        await conversation_ports().messages.set_media_url(message_id, media_url)
        collect(MessageMediaReady(chat_id=chat_id, message_id=message_id))


async def set_message_payload(message_id: int, payload: dict | None) -> None:
    async with unit_of_work():
        await conversation_ports().messages.set_payload(message_id, payload)
