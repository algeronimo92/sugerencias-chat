"""Persistencia durable del inbox de eventos Meta en el plano de control."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import delete, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from db.models import WebhookInbox
from db.session import control_session

MAX_BATCH_SIZE = 100
MAX_ATTEMPTS = 10
STALE_PROCESSING_AFTER = timedelta(minutes=5)
PROCESSED_RETENTION = timedelta(days=7)


def _item(row: WebhookInbox, *, accepted: bool = True) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "event_key": row.event_key,
        "accepted": accepted,
        "payload": row.payload,
        "attempt": row.attempts,
    }


async def receive_meta_events(events: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Inserta y reclama eventos nuevos; los duplicados no se reprocesan."""
    now = datetime.now(timezone.utc)
    items: list[dict[str, Any]] = []

    async with control_session() as session:
        for event in events:
            statement = (
                pg_insert(WebhookInbox)
                .values(
                    provider="meta",
                    event_key=event["event_key"],
                    connection_key=event["phone_number_id"],
                    phone_number_id=event["phone_number_id"],
                    event_type=event["event_type"],
                    payload=event["payload"],
                    status="processing",
                    attempts=1,
                    processing_started_at=now,
                )
                .on_conflict_do_nothing(index_elements=["provider", "event_key"])
                .returning(WebhookInbox)
            )
            inserted = (await session.execute(statement)).scalar_one_or_none()
            if inserted is not None:
                items.append(_item(inserted))
                continue

            existing = (
                await session.execute(
                    select(WebhookInbox).where(
                        WebhookInbox.provider == "meta",
                        WebhookInbox.event_key == event["event_key"],
                    )
                )
            ).scalar_one()
            items.append(_item(existing, accepted=False))

    return {
        "items": items,
        "accepted": sum(1 for item in items if item["accepted"]),
        "duplicates": sum(1 for item in items if not item["accepted"]),
    }


async def claim_meta_events(limit: int) -> dict[str, Any]:
    """Reclama fallos y ejecuciones abandonadas con bloqueo skip-locked."""
    limit = max(1, min(limit, MAX_BATCH_SIZE))
    now = datetime.now(timezone.utc)
    stale_before = now - STALE_PROCESSING_AFTER

    async with control_session() as session:
        await session.execute(
            delete(WebhookInbox).where(
                WebhookInbox.provider == "meta",
                WebhookInbox.status == "processed",
                WebhookInbox.processed_at < now - PROCESSED_RETENTION,
            )
        )

        rows = (
            await session.execute(
                select(WebhookInbox)
                .where(
                    WebhookInbox.provider == "meta",
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

    return {"items": [_item(row) for row in rows]}


async def complete_meta_event(inbox_id: UUID, *, status: str, error: str | None) -> str | None:
    """Marca el evento y devuelve su estado; ``None`` significa ID inexistente."""
    now = datetime.now(timezone.utc)
    values: dict[str, Any] = {
        "status": status,
        "last_error": error if status == "failed" else None,
        "updated_at": now,
    }
    if status == "processed":
        values["processed_at"] = now

    async with control_session() as session:
        result = await session.execute(
            update(WebhookInbox)
            .where(
                WebhookInbox.id == str(inbox_id),
                WebhookInbox.provider == "meta",
                WebhookInbox.status != "processed",
            )
            .values(**values)
            .returning(WebhookInbox.status)
        )
        persisted = result.scalar_one_or_none()
        if persisted is not None:
            return persisted

        return await session.scalar(
            select(WebhookInbox.status).where(WebhookInbox.id == str(inbox_id))
        )
