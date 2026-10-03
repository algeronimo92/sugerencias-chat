"""Seguimientos que una respuesta al cliente da por cumplidos.

Se resuelve después del commit del envío: una respuesta que no salió no puede
hacer desaparecer trabajo pendiente.
"""

from __future__ import annotations

from app.core.events import Phase, subscribe
from app.modules.conversations.public import MessageSent, ProviderMessageStored
from app.modules.tasks.repository import complete_assigned_seller_reply_tasks, complete_reply_tasks
from app.realtime.ws_manager import manager


@subscribe(MessageSent, phase=Phase.AFTER_COMMIT)
async def reply_sent_from_the_app(event: MessageSent) -> None:
    """Respondió un vendedor desde el CRM: se completan sus tareas de responder."""
    if event.actor_user_id is None:
        return
    if await complete_reply_tasks(event.chat_id, event.actor_user_id):
        await manager.broadcast({"type": "tasks_updated"})


@subscribe(ProviderMessageStored, phase=Phase.AFTER_COMMIT)
async def reply_sent_from_the_phone(event: ProviderMessageStored) -> None:
    """Un eco del teléfono no dice qué usuario escribió: se atribuye al
    vendedor asignado al lead."""
    if event.inbound:
        return
    if await complete_assigned_seller_reply_tasks(event.chat_id):
        await manager.broadcast({"type": "tasks_updated"})
