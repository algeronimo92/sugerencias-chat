"""Consumer contract: only the operations used outside this capability."""

from app.modules.auth.users_repository import (
    list_active_sellers,
    staff_phones,
)

__all__ = ['list_active_sellers', 'staff_phones']
