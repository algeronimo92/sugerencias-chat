"""Consumer contract: only the operations used outside this capability."""

from app.modules.leads.domain.types import (
    LeadStageKind,
    INITIAL_LEAD_STAGE,
    LEAD_STAGE_KEY_PATTERN,
)

__all__ = ['LeadStageKind', 'INITIAL_LEAD_STAGE', 'LEAD_STAGE_KEY_PATTERN']
