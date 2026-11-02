"""Recordatorios de tareas: se entregan al usuario conectado y, si no lo
está, quedan para el próximo ciclo.

La entrega llega por un puerto (``provide_reminder_delivery``): devuelve si
el usuario la recibió, y eso decide si el recordatorio se libera para
reintentarlo. ``app.composition`` lo conecta con el WebSocket.
"""

import logging
from collections.abc import Awaitable, Callable

from app.modules.tasks.repository import claim_due_reminders, release_reminder

logger = logging.getLogger(__name__)

ReminderDelivery = Callable[[int, dict], Awaitable[bool]]
_deliver: ReminderDelivery | None = None


def provide_reminder_delivery(deliver: ReminderDelivery) -> None:
    global _deliver
    _deliver = deliver


async def deliver_due_reminders() -> None:
    if _deliver is None:
        raise RuntimeError("La entrega de recordatorios no está configurada (app.composition)")
    for reminder in await claim_due_reminders():
        delivered = await _deliver(reminder["assigned_user_id"], {"type": "task_reminder", "task": reminder})
        if not delivered:
            # El usuario estaba desconectado: se reintenta en el próximo
            # ciclo y recibirá el aviso cuando vuelva a abrir la app.
            await release_reminder(reminder["task_id"])
