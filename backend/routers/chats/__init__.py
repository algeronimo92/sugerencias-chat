from fastapi import APIRouter

from routers.chats import (
    leads,
    reading,
    outbound,
    message_actions,
    read_state,
)
from routers.chats.common import _require_existing_lead  # noqa: F401
from routers.chats.leads import (  # noqa: F401
    add_chat_tag,
    create_chat,
    delete_chat,
    delete_chat_tag,
    get_chat,
    get_chat_activity,
    get_chats,
    get_kanban_counts,
    get_kanban_snapshot,
    get_kanban_stage,
    get_phone_config,
    get_sellers,
    get_unread_count,
    merge_chat,
    move_chat_stage,
    register_no_show,
    update_chat,
)
from routers.chats.reading import (  # noqa: F401
    get_history_availability,
    get_messages,
    get_service_window,
    get_whatsapp_history,
)
from routers.chats.outbound import (  # noqa: F401
    discard_message,
    forward_messages,
    retry_message,
    send_audio,
    send_location,
    send_contacts,
    send_media,
    send_message,
    send_sticker,
    send_template,
)
from routers.chats.message_actions import (  # noqa: F401
    delete_message,
    edit_message,
    get_pinned_messages,
    pin_chat_message,
    react_to_message,
    unpin_chat_message,
)
from routers.chats.read_state import (  # noqa: F401
    read_chat,
    unread_chat,
)

router = APIRouter()

router.include_router(leads.router)
router.include_router(reading.router)
router.include_router(outbound.router)
router.include_router(message_actions.router)
router.include_router(read_state.router)
