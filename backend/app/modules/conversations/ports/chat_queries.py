"""Consumer contract: only the operations used outside this capability."""

from app.modules.conversations.chat_rows import (
    CHATS_PAGE_SIZE,
    _row_to_chat,
    _tags_by_lead,
)
from app.modules.conversations.chat_queries import (
    _chat_columns,
    _chat_search_condition,
    _last_message_subquery,
    _matched_message_subquery,
    _search_rank_expression,
    _visible_lead_condition,
    fetch_chat,
    fetch_chats,
    get_customer_service_window,
)

__all__ = ['CHATS_PAGE_SIZE', '_row_to_chat', '_tags_by_lead', '_chat_columns', '_chat_search_condition', '_last_message_subquery', '_matched_message_subquery', '_search_rank_expression', '_visible_lead_condition', 'fetch_chat', 'fetch_chats', 'get_customer_service_window']
