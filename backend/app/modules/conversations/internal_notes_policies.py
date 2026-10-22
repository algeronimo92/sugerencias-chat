"""Pure policies and value types shared by cases and atomic persistence."""
from __future__ import annotations
from app.core.time_format import iso_utc

def _note(row, mentions: list[dict] | None = None) -> dict:
    return {
        "id": row["id"],
        "lead_id": row["lead_id"],
        "author_user_id": row["author_user_id"],
        "author_name": row["author_name"],
        "content": row["content"],
        "created_at": iso_utc(row["created_at"]),
        "updated_at": iso_utc(row["updated_at"]),
        "is_edited": row["updated_at"] > row["created_at"],
        "mentions": mentions or [],
    }
