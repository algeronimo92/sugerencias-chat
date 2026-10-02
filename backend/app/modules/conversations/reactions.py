"""Reacciones que manda el negocio desde el CRM o una automatización.

Primero se envía a Meta y recién con eso aceptado se guarda el evento y el
badge: una reacción que solo se viera de nuestro lado engañaría al vendedor.
"""

from datetime import datetime, timezone

from app.modules.conversations.message_edits import set_message_reaction
from app.integrations.meta.outbound import reaction_message, validate_message
from app.modules.conversations.provider_messages import record_reaction_event
from app.integrations.whatsapp.channels import current_channel


async def send_reaction(chat_id: str, target_wa_message_id: str, emoji: str) -> dict | None:
    """Envía la reacción (``emoji`` vacío la quita) y devuelve el mensaje
    objetivo con su badge actualizado."""
    message = reaction_message(target_wa_message_id, emoji)
    validate_message(message, final=True)
    receipt = await current_channel().sender.send(chat_id, message)
    await record_reaction_event(
        event_wa_id=receipt.provider_message_id,
        target_wa_message_id=target_wa_message_id,
        chat_id=chat_id,
        emoji=emoji,
        actor="business",
        provider_payload=receipt.sent_body,
        occurred_at=datetime.now(timezone.utc),
        webhook_event_id=None,
    )
    return await set_message_reaction(chat_id, target_wa_message_id, emoji, from_me=True)
