import asyncio
import logging

from services.productivity_service import claim_due_reminders, release_reminder
from services.ws_manager import manager

logger = logging.getLogger(__name__)


async def watch_task_reminders() -> None:
    while True:
        try:
            for reminder in await claim_due_reminders():
                delivered = await manager.send_to_user(
                    reminder["assigned_user_id"],
                    {"type": "task_reminder", "task": reminder},
                )
                if not delivered:
                    # El usuario estaba desconectado: se reintenta en el próximo
                    # ciclo y recibirá el aviso cuando vuelva a abrir la app.
                    await release_reminder(reminder["task_id"])
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Error procesando recordatorios de tareas")
        await asyncio.sleep(30)
