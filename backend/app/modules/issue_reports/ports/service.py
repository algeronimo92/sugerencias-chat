"""Consumer contract: only the operations used outside this capability."""

from app.modules.issue_reports.queries import (
    list_active_admin_ids,
)

__all__ = ['list_active_admin_ids']
