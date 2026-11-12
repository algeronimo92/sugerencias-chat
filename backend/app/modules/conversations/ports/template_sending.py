"""Consumer contract: only the operations used outside this capability."""

from app.modules.conversations.chat_messaging import (
    ChatMessagingError,
    official_template_message,
    send_template,
)

__all__ = ['ChatMessagingError', 'official_template_message', 'send_template']
