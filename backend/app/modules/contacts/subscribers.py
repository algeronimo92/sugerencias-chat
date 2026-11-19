"""La agenda sigue a los leads: quien escribe o se registra queda en ella, y
los paneles abiertos se enteran de cada cambio."""

from __future__ import annotations

from app.core.events import Phase, subscribe
from app.modules.contacts.events import ContactImportsChanged, ContactsChanged
from app.modules.contacts.service import ensure_contact_for_lead
from app.modules.leads.public import ConversationStarted, LeadCreated, LeadsMerged
from app.realtime.ws_manager import manager


# En la misma transacción que crea el lead: si el alta se deshace, el
# contacto tampoco queda.
@subscribe(LeadCreated, phase=Phase.TRANSACTION)
async def contact_for_new_lead(event: LeadCreated) -> None:
    await ensure_contact_for_lead(event.lead_id)


# Los leads que nacen de un mensaje entrante no pasan por ``create_lead``: su
# primer mensaje abre la conversación y eso es lo que se escucha.
@subscribe(ConversationStarted, phase=Phase.TRANSACTION)
async def contact_for_inbound_lead(event: ConversationStarted) -> None:
    await ensure_contact_for_lead(event.lead_id)


# El lead fusionado desaparece y sus contactos quedan sin enlace (ON DELETE
# SET NULL): el que sobrevive los vuelve a tomar por su número.
@subscribe(LeadsMerged, phase=Phase.TRANSACTION)
async def contact_for_merged_lead(event: LeadsMerged) -> None:
    await ensure_contact_for_lead(event.lead_id)


@subscribe(ContactsChanged, phase=Phase.AFTER_COMMIT)
async def announce_contacts_changed(_event: ContactsChanged) -> None:
    await manager.broadcast({"type": "contacts_updated"})


@subscribe(ContactImportsChanged, phase=Phase.AFTER_COMMIT)
async def announce_imports_changed(_event: ContactImportsChanged) -> None:
    await manager.broadcast({"type": "contact_imports_updated"})
