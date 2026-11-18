"""Consumer contract: only the operations used outside this capability."""

from app.modules.auth.users_repository import (
    emails_by_ids,
    list_active_sellers,
    staff_phones,
)

__all__ = ['emails_by_ids', 'list_active_sellers', 'staff_phones']
