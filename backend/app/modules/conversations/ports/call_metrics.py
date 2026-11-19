"""Consumer contract: only the operations used outside this capability."""

from app.modules.conversations.call_metrics import (
    call_metrics,
)

__all__ = ['call_metrics']
