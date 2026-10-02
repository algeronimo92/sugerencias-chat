"""Named domain use cases; atomic persistence belongs to the repository."""
from __future__ import annotations

from app.modules.ai import suggestions_repository

async def cache_suggestion_if_current(chat_id: str, suggestion: dict, expected_context_revision: str) -> str:
    return await suggestions_repository.cache_suggestion_if_current(chat_id, suggestion, expected_context_revision)

async def get_cached_suggestion(chat_id: str) -> dict | None:
    return await suggestions_repository.get_cached_suggestion(chat_id)

async def get_suggestion_status(chat_id: str) -> dict | None:
    return await suggestions_repository.get_suggestion_status(chat_id)
