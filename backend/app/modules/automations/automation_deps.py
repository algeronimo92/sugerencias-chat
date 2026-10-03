"""Colaboradores externos del motor de automatizaciones, agrupados para poder
sustituirlos en los tests.

El motor toca base de datos, Meta, el sistema de archivos, el reloj y
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

from app.db.session import get_sessionmaker
from app.modules.leads.public import Actor, LeadNotFound, TagNotAvailable
from app.modules.leads import public as leads
from app.modules.conversations.ports.chat_queries import (fetch_chat, get_customer_service_window)
from app.modules.conversations.ports.message_history import (fetch_latest_customer_message_target)
from app.modules.conversations.ports.message_outbox import (enqueue_messages)
from app.modules.conversations.ports.reactions import (send_reaction)
from app.modules.notifications.ports.service import (create_system_notification)
from app.modules.tasks.ports.repository import (create_task)
from app.modules.catalogs.ports.template_service import (record_template_use)
from app.modules.notifications.ports.push_service import (send_push_to_user)
from app.realtime.ws_manager import manager


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


async def _broadcast(payload: dict) -> None:
    await manager.broadcast(payload)


async def _send_to_user(user_id: int, payload: dict) -> None:
    await manager.send_to_user(user_id, payload)


# Adaptadores sobre los comandos de leads. El motor trabaja con la tarjeta del
# chat (un dict) y con "no encontrado" como valor de retorno; los comandos
# levantan errores de dominio. Los avisos de tiempo real los emiten los
# suscriptores de leads, no el motor.
async def update_lead(chat_id: str, values: dict, actor_type: str, actor_user_id: int | None) -> dict | None:
    try:
        await leads.update_lead(chat_id, values, actor=Actor(actor_type, actor_user_id))
    except LeadNotFound:
        return None
    return await fetch_chat(chat_id)


async def change_stage(
    chat_id: str, stage: str, actor_type: str, actor_user_id: int | None, metadata: dict | None = None,
) -> dict | None:
    try:
        await leads.change_stage(
            chat_id, stage, actor=Actor(actor_type, actor_user_id), metadata=metadata,
            triggers_automations=False,
        )
    except LeadNotFound:
        return None
    return await fetch_chat(chat_id)


async def assign_tag(chat_id: str, tag_id: int, user_id: int | None) -> bool:
    try:
        await leads.assign_tag(chat_id, tag_id, actor=Actor.of(user_id))
    except TagNotAvailable:
        return False
    return True


async def remove_tag(chat_id: str, tag_id: int, user_id: int | None) -> bool:
    try:
        await leads.remove_tag(chat_id, tag_id, actor=Actor.of(user_id))
    except TagNotAvailable:
        return False
    return True


@dataclass(frozen=True)
class AutomationDeps:
    session_factory: Callable[[], Any] = field(default=get_sessionmaker)
    now: Callable[[], datetime] = _utc_now

    fetch_chat: Callable[[str], Awaitable[dict | None]] = fetch_chat
    fetch_latest_customer_message_target: Callable[[str], Awaitable[dict | None]] = fetch_latest_customer_message_target
    update_lead: Callable[..., Awaitable[dict | None]] = update_lead
    change_stage: Callable[..., Awaitable[dict | None]] = change_stage
    assign_tag: Callable[..., Awaitable[bool]] = assign_tag
    remove_tag: Callable[..., Awaitable[bool]] = remove_tag
    get_customer_service_window: Callable[[str], Awaitable[dict | None]] = get_customer_service_window

    create_task: Callable[..., Awaitable[dict]] = create_task
    record_template_use: Callable[..., Awaitable[bool]] = record_template_use
    create_notification: Callable[..., Awaitable[dict]] = create_system_notification
    send_push: Callable[..., Awaitable[None]] = send_push_to_user

    # Encola en message_outbox en vez de llamar a Meta directo: da a las
    # automatizaciones los mismos reintentos con backoff y la misma
    # serialización estricta por chat que ya tiene cualquier mensaje manual
    # del vendedor. Las reacciones quedan afuera (send_reaction, abajo): no
    # tienen orden que preservar contra otros mensajes salientes y son
    # idempotentes (WhatsApp reemplaza la reacción propia).
    enqueue_messages: Callable[[str, list[dict]], Awaitable[list[dict]]] = enqueue_messages
    # (chat_id, wa_message_id objetivo, emoji) -> mensaje con el badge nuevo.
    send_reaction: Callable[[str, str, str], Awaitable[dict | None]] = send_reaction

    broadcast: Callable[[dict], Awaitable[None]] = _broadcast
    send_to_user: Callable[[int, dict], Awaitable[None]] = _send_to_user

    def session(self):
        """Abre una sesión nueva. Envuelve la doble llamada de
        get_sessionmaker()() para que el motor no dependa de esa forma."""
        return self.session_factory()()


DEFAULT_DEPS = AutomationDeps()
