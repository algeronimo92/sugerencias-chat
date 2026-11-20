"""Consumer contract: only the operations used outside this capability."""

from app.modules.leads.visibility import (
    call_agents_for,
    ensure_lead_visible,
    lead_audience,
    lead_recipients,
    require_visible_lead,
    seller_scope,
    seller_scope_by_id,
    visible_lead_ids,
)
from app.modules.leads.queries import lead_ids_owned_by

__all__ = ['call_agents_for', 'ensure_lead_visible', 'lead_audience', 'lead_recipients', 'lead_ids_owned_by', 'require_visible_lead', 'seller_scope', 'seller_scope_by_id', 'visible_lead_ids']
