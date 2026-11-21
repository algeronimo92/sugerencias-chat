"""Consumer contract: only the operations used outside this capability."""

from app.modules.auth.auth_service import (
    get_current_user,
    require_permission,
)
from app.modules.auth.permissions import Permission, can

__all__ = ['Permission', 'can', 'get_current_user', 'require_permission']
