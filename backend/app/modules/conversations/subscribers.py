"""Reacciones de ``conversations`` a sus propios eventos, después del commit.

Los paneles se enteran por WebSocket solo de lo que quedó confirmado, y el
worker del outbox se despierta en cuanto hay trabajo nuevo. Antes cada API y
el procesador del webhook emitían estos avisos a mano, cada uno a su manera.
"""

from __future__ import annotations

from app.core.events import Phase, subscribe
from app.modules.auth.ports.users import list_call_agents
from app.modules.conversations.domain.events import (
    CallAnswered,
    CallClaimed,
    CallDismissed,
    CallEnded,
    CallReleased,
    CallRinging,
    ChatMarkedUnread,
    ChatRead,
    ExternalMessagesSynced,
    InternalNotesChanged,
    MessageDiscarded,
    MessageFailed,
    MessageMediaReady,
    MessagePinChanged,
    MessageSent,
    MessageStatusChanged,
    OutboundQueued,
    ProviderMessageChanged,
    ProviderMessageStored,
    ReactionChanged,
    ScheduledMessageChanged,
)
from app.modules.conversations.infrastructure.outbox_worker import notify_new_work
from app.modules.conversations.message_queries import fetch_message_by_wa_id
from app.realtime.ws_manager import manager


@subscribe(OutboundQueued, phase=Phase.AFTER_COMMIT)
async def wake_the_outbox(_event: OutboundQueued) -> None:
    await notify_new_work()


@subscribe(OutboundQueued, phase=Phase.AFTER_COMMIT)
async def outbound_queued(event: OutboundQueued) -> None:
    await manager.broadcast({"type": "chats_updated", "chat_id": event.chat_id, "reason": "outbound_queued"})


@subscribe(MessageSent, phase=Phase.AFTER_COMMIT)
async def message_sent(event: MessageSent) -> None:
    await manager.broadcast({
        "type": "chats_updated",
        "chat_id": event.chat_id,
        "reason": "outbound_message",
        "message_statuses": [{"id": event.message_id, "outbox_status": "sent"}],
    })
    if event.scheduled:
        await manager.broadcast({"type": "scheduled_messages_updated", "chat_id": event.chat_id, "status": "sent"})


@subscribe(MessageFailed, phase=Phase.AFTER_COMMIT)
async def message_failed(event: MessageFailed) -> None:
    await manager.broadcast({
        "type": "chats_updated",
        "chat_id": event.chat_id,
        "reason": "message_status",
        "message_statuses": [{"id": event.message_id, "outbox_status": "failed"}],
    })
    if event.scheduled:
        await manager.broadcast({"type": "scheduled_messages_updated", "chat_id": event.chat_id, "status": "failed"})


@subscribe(MessageDiscarded, phase=Phase.AFTER_COMMIT)
async def message_discarded(event: MessageDiscarded) -> None:
    await manager.broadcast({
        "type": "chats_updated",
        "chat_id": event.chat_id,
        "reason": "message_status",
        "message_statuses": [{"id": event.message_id, "outbox_status": "discarded"}],
    })


@subscribe(ProviderMessageStored, phase=Phase.AFTER_COMMIT)
async def provider_message_stored(event: ProviderMessageStored) -> None:
    latest = await fetch_message_by_wa_id(event.wa_message_id)
    reason = "outbound_message"
    if event.inbound:
        reason = "inbound_message"
    await manager.broadcast({
        "type": "chats_updated",
        "chat_id": event.chat_id,
        "reason": reason,
        **({"latest_message": latest} if latest is not None else {}),
    })


@subscribe(ExternalMessagesSynced, phase=Phase.AFTER_COMMIT)
async def external_messages(event: ExternalMessagesSynced) -> None:
    await manager.broadcast({
        "type": "chats_updated",
        "reason": "external_message",
        "latest_message": event.latest,
        "chat_id": event.chat_id,
    })


@subscribe(MessageStatusChanged, phase=Phase.AFTER_COMMIT)
async def message_status_changed(event: MessageStatusChanged) -> None:
    await manager.broadcast({
        "type": "chats_updated",
        "chat_id": event.chat_id,
        "reason": "message_status",
        "message_statuses": [{"id": event.message_id, "meta_status": event.meta_status}],
    })


@subscribe(ReactionChanged, phase=Phase.AFTER_COMMIT)
async def reaction_changed(event: ReactionChanged) -> None:
    await manager.broadcast({"type": "chats_updated", "chat_id": event.chat_id, "reason": "reaction"})


@subscribe(MessageMediaReady, phase=Phase.AFTER_COMMIT)
async def media_ready(event: MessageMediaReady) -> None:
    await manager.broadcast({"type": "chats_updated", "chat_id": event.chat_id, "reason": "media_ready"})


@subscribe(ProviderMessageChanged, phase=Phase.AFTER_COMMIT)
async def provider_message_changed(event: ProviderMessageChanged) -> None:
    await manager.broadcast({"type": "chats_updated", "chat_id": event.chat_id, "reason": "message_changed"})


@subscribe(MessagePinChanged, phase=Phase.AFTER_COMMIT)
async def pin_changed(event: MessagePinChanged) -> None:
    await manager.broadcast({"type": "chats_updated", "chat_id": event.chat_id, "reason": "message_pinned"})


@subscribe(ChatRead, phase=Phase.AFTER_COMMIT)
async def chat_read(event: ChatRead) -> None:
    await manager.broadcast({"type": "chats_updated", "chat_id": event.chat_id, "reason": "read"})


@subscribe(ChatMarkedUnread, phase=Phase.AFTER_COMMIT)
async def chat_unread(event: ChatMarkedUnread) -> None:
    await manager.broadcast({"type": "chats_updated", "chat_id": event.chat_id, "reason": "unread"})


@subscribe(ScheduledMessageChanged, phase=Phase.AFTER_COMMIT)
async def scheduled_changed(event: ScheduledMessageChanged) -> None:
    await manager.broadcast({
        "type": "scheduled_messages_updated", "chat_id": event.chat_id, "status": event.status,
    })


@subscribe(InternalNotesChanged, phase=Phase.AFTER_COMMIT)
async def notes_changed(event: InternalNotesChanged) -> None:
    await manager.broadcast({"type": "internal_notes_updated", "lead_id": event.chat_id})


# Llamadas: el aviso va persona por persona a quienes atienden, no a todo el
# negocio. El WebSocket no es garantía (ver db/signals): la pantalla además
# consulta las que suenan cada pocos segundos.
@subscribe(CallRinging, phase=Phase.AFTER_COMMIT)
async def call_ringing(event: CallRinging) -> None:
    for agent in await list_call_agents():
        await manager.send_to_user(agent["id"], {
            "type": "call_incoming", "call_id": event.call_id, "chat_id": event.chat_id,
            "caller_name": event.caller_name,
        })
    await manager.broadcast({"type": "chats_updated", "chat_id": event.chat_id, "reason": "inbound_message"})


@subscribe(CallClaimed, phase=Phase.AFTER_COMMIT)
async def call_claimed(event: CallClaimed) -> None:
    for agent in await list_call_agents():
        await manager.send_to_user(agent["id"], {
            "type": "call_updated", "call_id": event.call_id, "chat_id": event.chat_id,
            "status": "connecting", "handled_by_user_id": event.user_id,
        })


@subscribe(CallAnswered, phase=Phase.AFTER_COMMIT)
async def call_answered(event: CallAnswered) -> None:
    for agent in await list_call_agents():
        await manager.send_to_user(agent["id"], {
            "type": "call_updated", "call_id": event.call_id, "chat_id": event.chat_id,
            "status": "accepted", "handled_by_user_id": event.user_id,
        })


@subscribe(CallReleased, phase=Phase.AFTER_COMMIT)
async def call_released(event: CallReleased) -> None:
    for agent in await list_call_agents():
        await manager.send_to_user(agent["id"], {
            "type": "call_updated", "call_id": event.call_id, "chat_id": event.chat_id,
            "status": "ringing", "handled_by_user_id": None,
        })


@subscribe(CallDismissed, phase=Phase.AFTER_COMMIT)
async def call_dismissed(event: CallDismissed) -> None:
    # Sus otras pestañas dejan de sonar; el resto sigue.
    await manager.send_to_user(event.user_id, {
        "type": "call_updated", "call_id": event.call_id, "chat_id": event.chat_id,
        "status": "dismissed", "handled_by_user_id": None,
    })


@subscribe(CallEnded, phase=Phase.AFTER_COMMIT)
async def call_ended(event: CallEnded) -> None:
    for agent in await list_call_agents():
        await manager.send_to_user(agent["id"], {
            "type": "call_ended", "call_id": event.call_id, "chat_id": event.chat_id,
            "status": event.status, "cause": event.cause,
            "handled_by_user_id": event.handled_by_user_id, "caller_name": event.caller_name,
        })
    await manager.broadcast({"type": "chats_updated", "chat_id": event.chat_id, "reason": "inbound_message"})
