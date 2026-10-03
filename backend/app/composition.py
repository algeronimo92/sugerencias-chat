"""Raíz de composición compartida por la API y los workers.

Es el único lugar que conoce a la vez los puertos de la aplicación y sus
implementaciones: conecta cada adaptador a su puerto y registra los
suscriptores de eventos. Así ningún módulo depende de que otro lo haya
importado antes, y la API y el proceso worker ven exactamente el mismo
cableado.
"""

from __future__ import annotations

import importlib

from app.integrations.whatsapp.channels import current_channel
from app.modules.conversations.application.ports import ConversationPorts, provide_conversation_ports
from app.modules.conversations.chat_queries import get_customer_service_window
from app.modules.conversations.infrastructure.meta_contract import MetaMessageContract
from app.modules.conversations.infrastructure.sql_inbox import SqlInboxState
from app.modules.conversations.infrastructure.sql_messages import SqlMessageStore
from app.modules.conversations.infrastructure.sql_outbox import SqlOutboxStore
from app.modules.conversations.infrastructure.sql_scheduled import SqlScheduledStore
from app.modules.leads.application.ports import provide_lead_repository
from app.modules.leads.infrastructure.repository import SqlLeadRepository

# Cada módulo que reacciona a eventos expone un ``subscribers.py``.
SUBSCRIBER_MODULES: tuple[str, ...] = (
    "app.modules.conversations.subscribers",
    "app.modules.leads.subscribers",
    "app.modules.automations.subscribers",
    "app.modules.tasks.subscribers",
    "app.modules.notifications.subscribers",
)

_configured = False


def register_adapters() -> None:
    provide_lead_repository(SqlLeadRepository())
    provide_conversation_ports(ConversationPorts(
        outbox=SqlOutboxStore(),
        inbox=SqlInboxState(),
        messages=SqlMessageStore(),
        scheduled=SqlScheduledStore(),
        contract=MetaMessageContract(),
        service_window=get_customer_service_window,
        channel=current_channel,
    ))


def register_subscribers() -> None:
    for name in SUBSCRIBER_MODULES:
        importlib.import_module(name)


def configure() -> None:
    """Idempotente: la API, los workers y los tests pueden llamarla."""
    global _configured
    if _configured:
        return
    register_adapters()
    register_subscribers()
    _configured = True
