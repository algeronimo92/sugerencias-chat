"""Consumer contract: only the operations used outside this capability."""

from app.modules.leads.assignment import (
    assign_next_seller,
    parse_excluded_ids,
)

__all__ = ['assign_next_seller', 'parse_excluded_ids']
