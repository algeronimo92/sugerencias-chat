"""Seguimientos que una respuesta al cliente da por cumplidos.

Se resuelve después del commit del envío: una respuesta que no salió no puede
hacer desaparecer trabajo pendiente.
"""

from __future__ import annotations

from app.core.events import Phase, subscribe
from app.modules.conversations.public import MessageSent, ProviderMessageStored
from app.modules.tasks.events import TasksChanged
from app.modules.tasks.repository import complete_reply_tasks
from app.realtime.ws_manager import manager


@subscribe(MessageSent, phase=Phase.AFTER_COMMIT)
async def reply_sent_from_the_app(event: MessageSent) -> None:
    """Alguien del equipo respondió desde el CRM: se completan los
    seguimientos del lead, sean de quien sean."""
    if event.actor_user_id is None:
        return
    if await complete_reply_tasks(event.chat_id, event.actor_user_id):
        await manager.broadcast({"type": "tasks_updated"})


@subscribe(ProviderMessageStored, phase=Phase.AFTER_COMMIT)
async def reply_sent_from_the_phone(event: ProviderMessageStored) -> None:
    """Un eco del teléfono no dice qué usuario escribió: los seguimientos se
    cierran igual, sin atribuírselos a nadie."""
    if event.inbound:
        return
    if await complete_reply_tasks(event.chat_id, None):
        await manager.broadcast({"type": "tasks_updated"})


@subscribe(TasksChanged, phase=Phase.AFTER_COMMIT)
async def announce_tasks_changed(event: TasksChanged) -> None:
    await manager.broadcast({"type": "tasks_updated"})
