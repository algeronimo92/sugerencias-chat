"""Contrato de ``leads`` para otros módulos e integraciones.

Cambiar un lead siempre pasa por estos comandos; reaccionar a un cambio, por
sus eventos. Ningún otro módulo escribe la tabla ``leads`` por su cuenta.
"""

from app.modules.leads.application.commands import (
    StageChangeResult,
    assign_tag,
    change_stage,
    create_lead,
    open_conversation_from_inbound,
    register_follow_up,
    remove_tag,
    update_lead,
)
from app.modules.leads.domain.errors import (
    InvalidLeadStageError,
    LeadAlreadyExists,
    LeadNotFound,
    SellerNotFound,
    TagNotAvailable,
)
from app.modules.leads.domain.events import (
    ConversationStarted,
    LeadChangedOutside,
    LeadCreated,
    LeadDeleted,
    LeadEvent,
    LeadNoShowRegistered,
    LeadStageChanged,
    LeadsMerged,
    LeadTagged,
    LeadUpdated,
)
from app.modules.leads.domain.lead import Actor
from app.modules.leads.queries import fetch_lead_raw, fetch_messages_raw

__all__ = [
    "Actor",
    "LeadChangedOutside",
    "ConversationStarted",
    "InvalidLeadStageError",
    "LeadAlreadyExists",
    "LeadCreated",
    "LeadDeleted",
    "LeadEvent",
    "LeadNoShowRegistered",
    "LeadNotFound",
    "LeadStageChanged",
    "LeadTagged",
    "LeadUpdated",
    "LeadsMerged",
    "SellerNotFound",
    "StageChangeResult",
    "TagNotAvailable",
    "assign_tag",
    "change_stage",
    "create_lead",
    "fetch_lead_raw",
    "fetch_messages_raw",
    "open_conversation_from_inbound",
    "register_follow_up",
    "remove_tag",
    "update_lead",
]
