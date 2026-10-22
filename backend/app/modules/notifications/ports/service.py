"""Consumer contract: only the operations used outside this capability."""

from app.modules.notifications.service import (
    create_mention_notifications,
    create_system_notification,
)

__all__ = ['create_mention_notifications', 'create_system_notification']
