"""Consumer contract: only the operations used outside this capability."""

from app.modules.leads.touch import (
    touch_automated_reply_stmt,
    touch_last_read_stmt,
    touch_ultimo_mensaje_stmt,
)

__all__ = ['touch_automated_reply_stmt', 'touch_last_read_stmt', 'touch_ultimo_mensaje_stmt']
