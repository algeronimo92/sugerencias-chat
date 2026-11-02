"""Consumer contract: only the operations used outside this capability."""

from app.modules.conversations.message_media import (
    mediatype_from_content_type,
)

__all__ = ['mediatype_from_content_type']
