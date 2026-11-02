"""Pure policies and value types shared by cases and atomic persistence."""
from __future__ import annotations
from app.core.time_format import iso_utc

def _notification(row) -> dict:
    return {
        "id": row.id,
        "notification_type": row.notification_type,
        "title": row.title,
        "body": row.body,
        "lead_id": row.lead_id,
        "source_id": row.source_id,
        "metadata": row.metadata_,
        "read_at": iso_utc(row.read_at),
        "created_at": iso_utc(row.created_at),
    }
