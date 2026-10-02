from app.modules.conversations import internal_notes_repository
from app.modules.conversations.internal_notes_policies import (_note)
from datetime import datetime, timezone


from app.db.models.leads import Lead, LeadActivity, LeadNote, LeadNoteMention
from app.db.models.auth import User
from app.db.models.notifications import UserNotification
from app.core.time_format import iso_utc


def _note_query():
    return internal_notes_repository._note_query()


async def _mentions_for_notes(session, note_ids: list[int]) -> dict[int, list[dict]]:
    return await internal_notes_repository._mentions_for_notes(session, note_ids)


async def list_internal_notes(lead_id: str) -> list[dict] | None:
    return await internal_notes_repository.list_internal_notes(lead_id)


async def get_internal_note(note_id: int) -> dict | None:
    return await internal_notes_repository.get_internal_note(note_id)


async def _validate_mentions(session, mentioned_user_ids: list[int]) -> list[int]:
    return await internal_notes_repository._validate_mentions(session, mentioned_user_ids)


async def create_internal_note(lead_id: str, content: str, mentioned_user_ids: list[int], author_user_id: int) -> dict | None:
    return await internal_notes_repository.create_internal_note(lead_id, content, mentioned_user_ids, author_user_id)


async def update_internal_note(note_id: int, content: str, mentioned_user_ids: list[int], actor_user_id: int) -> tuple[dict | None, list[int]]:
    return await internal_notes_repository.update_internal_note(note_id, content, mentioned_user_ids, actor_user_id)


async def delete_internal_note(note_id: int, actor_user_id: int) -> dict | None:
    return await internal_notes_repository.delete_internal_note(note_id, actor_user_id)


async def mark_internal_mentions_read(lead_id: str, user_id: int) -> None:
    return await internal_notes_repository.mark_internal_mentions_read(lead_id, user_id)


async def mark_note_views_read(lead_id: str, user_id: int) -> bool:
    return await internal_notes_repository.mark_note_views_read(lead_id, user_id)
