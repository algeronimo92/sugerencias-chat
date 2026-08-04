"""Colaboradores externos del motor de automatizaciones, agrupados para poder
sustituirlos en los tests.

El motor toca base de datos, Evolution API, el sistema de archivos, el reloj y
los websockets. Con esos accesos incrustados no se puede ejercitar la lógica
sin una base real y sin mandar WhatsApps de verdad, así que se resuelven a
través de este objeto: producción usa `default_deps()` y los tests construyen
uno con dobles.

La cantidad de campos refleja lo que el motor realmente necesita hoy; es
también la señal de que `_execute_action` hace demasiado y de que conviene
partirlo en un handler por tipo de acción.
"""

from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any

from db.session import get_sessionmaker
from services.db_service import (
    assign_tag,
    fetch_chat,
    fetch_latest_customer_message_target,
    get_customer_service_window,
    remove_tag,
    set_message_reaction,
    update_lead,
    update_lead_stage,
)
from services.evolution_service import send_whatsapp_reaction
from services.message_outbox import enqueue_messages
from services.notification_service import create_system_notification
from services.productivity_service import create_task, record_template_use
from services.ws_manager import manager


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


async def _broadcast(payload: dict) -> None:
    await manager.broadcast(payload)


async def _send_to_user(user_id: int, payload: dict) -> None:
    await manager.send_to_user(user_id, payload)


@dataclass(frozen=True)
class AutomationDeps:
    session_factory: Callable[[], Any] = field(default=get_sessionmaker)
    now: Callable[[], datetime] = _utc_now

    fetch_chat: Callable[[str], Awaitable[dict | None]] = fetch_chat
    fetch_latest_customer_message_target: Callable[[str], Awaitable[dict | None]] = fetch_latest_customer_message_target
    update_lead: Callable[..., Awaitable[dict | None]] = update_lead
    update_lead_stage: Callable[..., Awaitable[dict | None]] = update_lead_stage
    assign_tag: Callable[..., Awaitable[bool]] = assign_tag
    remove_tag: Callable[..., Awaitable[bool]] = remove_tag
    set_message_reaction: Callable[..., Awaitable[dict | None]] = set_message_reaction
    get_customer_service_window: Callable[[str], Awaitable[dict | None]] = get_customer_service_window

    create_task: Callable[..., Awaitable[dict]] = create_task
    record_template_use: Callable[..., Awaitable[bool]] = record_template_use
    create_notification: Callable[..., Awaitable[dict]] = create_system_notification

    # Encola en message_outbox en vez de llamar a Evolution API directo: da a
    # las automatizaciones los mismos reintentos con backoff y la misma
    # serialización estricta por chat que ya tiene cualquier mensaje manual
    # del vendedor. Las reacciones quedan afuera (send_reaction, abajo): no
    # tienen orden que preservar contra otros mensajes salientes y son
    # idempotentes (WhatsApp reemplaza la reacción propia).
    enqueue_messages: Callable[[str, list[dict]], Awaitable[list[dict]]] = enqueue_messages
    send_reaction: Callable[[dict, str], Awaitable[dict]] = send_whatsapp_reaction

    broadcast: Callable[[dict], Awaitable[None]] = _broadcast
    send_to_user: Callable[[int, dict], Awaitable[None]] = _send_to_user

    def session(self):
        """Abre una sesión nueva. Envuelve la doble llamada de
        get_sessionmaker()() para que el motor no dependa de esa forma."""
        return self.session_factory()()


DEFAULT_DEPS = AutomationDeps()
