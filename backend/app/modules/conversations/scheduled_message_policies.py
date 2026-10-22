"""Pure policies and value types shared by cases and atomic persistence."""
from __future__ import annotations
from app.core.time_format import iso_utc_micros

CLAIM_LIMIT = 50

STALE_PROCESSING_MINUTES = 5

def _item(row) -> dict:
    return {
        "id": row["id"],
        "lead_id": row["lead_id"],
        "text": row["text"],
        "scheduled_at": iso_utc_micros(row["scheduled_at"]),
        "status": row["status"],
        "created_by_user_id": row["created_by_user_id"],
        "created_by_user_name": row["created_by_user_name"],
        "queued_message_id": row["queued_message_id"],
        "error": row["error"],
        "created_at": iso_utc_micros(row["created_at"]),
    }
