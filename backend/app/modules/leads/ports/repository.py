"""Consumer contract: only the operations used outside this capability."""

from app.modules.leads.repository import (
    _activity_insert,
    _record_activity,
    _schedule_stage_automations,
    fetch_lead_raw,
    fetch_messages_raw,
    open_conversation_from_inbound,
    update_lead,
    update_lead_stage,
)

__all__ = ['_activity_insert', '_record_activity', '_schedule_stage_automations', 'fetch_lead_raw', 'fetch_messages_raw', 'open_conversation_from_inbound', 'update_lead', 'update_lead_stage']
