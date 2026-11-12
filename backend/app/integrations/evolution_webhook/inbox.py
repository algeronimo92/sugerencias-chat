from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import delete, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db.models.control import WebhookInbox
from app.db.session import control_session

PROVIDER = "evolution"
MAX_ATTEMPTS = 10
STALE_PROCESSING_AFTER = timedelta(minutes=5)
PROCESSED_RETENTION = timedelta(days=7)


@dataclass(frozen=True)
class InboxEvent:
    id: str
    event_type: str
    payload: dict
    attempts: int


def _event_key(payload: dict) -> str:
    canonical = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return hashlib.sha256(canonical.encode()).hexdigest()


async def store_event(payload: dict) -> tuple[str | None, bool]:
    event_type = str(payload.get("event") or "unknown")
    instance = str(payload.get("instance") or "") or None
    async with control_session() as session:
        inserted = (
            await session.execute(
                pg_insert(WebhookInbox)
                .values(
                    provider=PROVIDER,
                    event_key=_event_key(payload),
                    connection_key=instance,
                    event_type=event_type,
                    payload=payload,
                    status="received",
                    attempts=0,
                )
                .on_conflict_do_nothing(index_elements=["provider", "event_key"])
                .returning(WebhookInbox.id)
            )
        ).scalar_one_or_none()
    return (str(inserted) if inserted else None, inserted is None)


async def claim_events(limit: int) -> list[InboxEvent]:
    now = datetime.now(timezone.utc)
    stale_before = now - STALE_PROCESSING_AFTER
    async with control_session() as session:
        rows = (
            await session.execute(
                select(WebhookInbox)
                .where(
                    WebhookInbox.provider == PROVIDER,
                    WebhookInbox.attempts < MAX_ATTEMPTS,
                    or_(
                        WebhookInbox.status.in_(("received", "failed")),
                        (WebhookInbox.status == "processing")
                        & (WebhookInbox.processing_started_at < stale_before),
                    ),
                )
                .order_by(WebhookInbox.received_at, WebhookInbox.id)
                .limit(limit)
                .with_for_update(skip_locked=True)
            )
        ).scalars().all()
        for row in rows:
            row.status = "processing"
            row.attempts += 1
            row.processing_started_at = now
            row.last_error = None
        return [
            InboxEvent(str(row.id), row.event_type, row.payload, row.attempts)
            for row in rows
        ]


async def complete_event(event_id: str | UUID, *, error: str | None = None) -> None:
    now = datetime.now(timezone.utc)
    values = {"updated_at": now}
    if error is None:
        values.update(status="processed", processed_at=now, last_error=None)
    else:
        values.update(status="failed", last_error=error[:2000])
    async with control_session() as session:
        await session.execute(
            update(WebhookInbox)
            .where(WebhookInbox.id == str(event_id), WebhookInbox.provider == PROVIDER)
            .values(**values)
        )


async def purge_processed() -> None:
    cutoff = datetime.now(timezone.utc) - PROCESSED_RETENTION
    async with control_session() as session:
        await session.execute(
            delete(WebhookInbox).where(
                WebhookInbox.provider == PROVIDER,
                WebhookInbox.status == "processed",
                WebhookInbox.processed_at < cutoff,
            )
        )
