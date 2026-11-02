"""Consumer contract: only the operations used outside this capability."""

from app.modules.conversations.service_window import (
    SERVICE_WINDOW_CLOSED_ERROR,
    SERVICE_WINDOW_ERROR_CODE,
)

__all__ = ['SERVICE_WINDOW_CLOSED_ERROR', 'SERVICE_WINDOW_ERROR_CODE']
