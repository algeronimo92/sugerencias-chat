from fastapi import APIRouter

from app.modules.conversations import (
    reading_api as reading,
    outbound_api as outbound,
    message_actions_api as message_actions,
    read_state_api as read_state,
)
from app.modules.conversations.common import _require_existing_lead  # noqa: F401
from app.modules.conversations.reading_api import get_messages, get_service_window
from app.modules.conversations.outbound_api import discard_message, forward_messages, retry_message, send_audio, send_location, send_contacts, send_interactive, send_media, send_message, send_sticker, send_template
from app.modules.conversations.message_actions_api import get_pinned_messages, pin_chat_message, react_to_message, unpin_chat_message
from app.modules.conversations.read_state_api import read_chat, unread_chat

router = APIRouter()

router.include_router(reading.router)
router.include_router(outbound.router)
router.include_router(message_actions.router)
router.include_router(read_state.router)
