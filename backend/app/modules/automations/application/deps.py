"""Colaboradores del motor de automatizaciones, agrupados para poder
sustituirlos en los tests.

El motor guarda ejecuciones (``executions``), mueve leads, encola mensajes,
crea tareas y notificaciones, y avisa lo que pasó publicando eventos. Nada de
eso está incrustado: llega por este objeto, que producción arma en
``default_deps()`` con los contratos públicos de cada módulo dueño y los
tests con dobles.
"""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timezone

from app.core.events import DomainEvent, publish
from app.modules.automations.application.ports import ExecutionStore, automation_ports
from app.modules.catalogs.ports.template_delivery import fetch_template_for_delivery
from app.modules.catalogs.ports.template_service import record_template_use
from app.modules.conversations.ports.chat_queries import fetch_chat, get_customer_service_window
from app.modules.conversations.ports.latest_message_queries import latest_message, latest_outbound_media_wa_id
from app.modules.conversations.ports.message_history import fetch_latest_customer_message_target
from app.modules.conversations.ports.outbound import queue_messages, send_reaction
from app.modules.leads import public as leads
from app.modules.leads.public import Actor, LeadNotFound, TagNotAvailable
from app.modules.media.ports.media_library_service import get_media_asset
from app.modules.notifications.ports.service import create_system_notification
from app.modules.tasks.ports.repository import create_task


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


async def _publish(*events: DomainEvent) -> None:
    await publish(*events)


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
    executions: ExecutionStore
    now: Callable[[], datetime] = _utc_now
    # Los avisos salen como eventos: los suscriptores deciden a quién avisar.
    publish: Callable[..., Awaitable[None]] = _publish

    fetch_chat: Callable[[str], Awaitable[dict | None]] = fetch_chat
    fetch_latest_customer_message_target: Callable[[str], Awaitable[dict | None]] = fetch_latest_customer_message_target
    latest_message: Callable[[str], Awaitable[dict | None]] = latest_message
    latest_outbound_media_wa_id: Callable[[str], Awaitable[str | None]] = latest_outbound_media_wa_id
    update_lead: Callable[..., Awaitable[dict | None]] = update_lead
    change_stage: Callable[..., Awaitable[dict | None]] = change_stage
    assign_tag: Callable[..., Awaitable[bool]] = assign_tag
    remove_tag: Callable[..., Awaitable[bool]] = remove_tag
    fetch_lead: Callable[[str], Awaitable[dict | None]] = leads.fetch_lead_raw
    get_customer_service_window: Callable[[str], Awaitable[dict | None]] = get_customer_service_window

    load_template: Callable[[int], Awaitable[dict | None]] = fetch_template_for_delivery
    load_media_asset: Callable[[int], Awaitable[dict | None]] = get_media_asset
    create_task: Callable[..., Awaitable[dict]] = create_task
    record_template_use: Callable[..., Awaitable[bool]] = record_template_use
    create_notification: Callable[..., Awaitable[dict]] = create_system_notification

    # Encola en message_outbox en vez de llamar a Meta directo: da a las
    # automatizaciones los mismos reintentos con backoff y la misma
    # serialización estricta por chat que ya tiene cualquier mensaje manual
    # del vendedor. Las reacciones quedan afuera (send_reaction, abajo): no
    # tienen orden que preservar contra otros mensajes salientes y son
    # idempotentes (WhatsApp reemplaza la reacción propia).
    enqueue_messages: Callable[[str, list[dict]], Awaitable[list[dict]]] = queue_messages
    # (chat_id, wa_message_id objetivo, emoji) -> mensaje con el badge nuevo.
    send_reaction: Callable[[str, str, str], Awaitable[dict | None]] = send_reaction


def default_deps() -> AutomationDeps:
    return AutomationDeps(executions=automation_ports().executions)
