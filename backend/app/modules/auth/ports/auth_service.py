"""Consumer contract: only the operations used outside this capability."""

from app.modules.auth.auth_service import (
    get_current_user,
    require_admin,
)

__all__ = ['get_current_user', 'require_admin']
