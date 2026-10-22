"""Consumer contract: only the operations used outside this capability."""

from app.modules.leads.assignment import (
    pick_next_vendedor_id,
)

__all__ = ['pick_next_vendedor_id']
