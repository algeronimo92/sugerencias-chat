"""Consumer contract: only the operations used outside this capability."""

from app.modules.notifications.push_service import (
    send_push_to_user,
)

__all__ = ['send_push_to_user']
