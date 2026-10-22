"""Consumer contract: only the operations used outside this capability."""

from app.modules.auth.account_actions import (
    try_send_operational_alert,
)

__all__ = ['try_send_operational_alert']
