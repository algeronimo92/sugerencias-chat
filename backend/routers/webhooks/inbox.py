"""Inbox durable para eventos de Meta recibidos por n8n.

n8n normaliza el sobre, registra cada evento aquí y recién entonces confirma
la recepción a Meta. El procesamiento ordinario y el replay usan el mismo
payload normalizado. Esta tabla pertenece al plano de control porque la
recepción ocurre antes de abrir el schema del número receptor.
"""

from datetime import datetime, timedelta, timezone
from typing import Any, Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from sqlalchemy import or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from db.models import WebhookInbox
from db.session import control_session
from routers.webhooks.common import webhooks_router


router = webhooks_router()

MAX_BATCH_SIZE = 100
MAX_ATTEMPTS = 10
STALE_PROCESSING_AFTER = timedelta(minutes=5)


class MetaInboxEvent(BaseModel):
    event_key: str = Field(min_length=1, max_length=255)
    event_type: str = Field(min_length=1, max_length=80)
    phone_number_id: str = Field(min_length=1, max_length=128)
    payload: dict[str, Any]

    model_config = ConfigDict(extra="forbid")


class MetaInboxBatch(BaseModel):
    events: list[MetaInboxEvent] = Field(min_length=1, max_length=MAX_BATCH_SIZE)

    model_config = ConfigDict(extra="forbid")


class InboxCompletion(BaseModel):
    status: Literal["processed", "failed"] = "processed"
    error: str | None = Field(default=None, max_length=2000)

    model_config = ConfigDict(extra="forbid")


def _item(row: WebhookInbox, *, accepted: bool = True) -> dict[str, Any]:
    return {
        "id": str(row.id),
        "event_key": row.event_key,
        "accepted": accepted,
        "payload": row.payload,
        "attempt": row.attempts,
    }


@router.post("/meta-events/inbox")
async def receive_meta_events(body: MetaInboxBatch) -> dict[str, Any]:
    """Persiste eventos antes del ACK y reclama los nuevos para esta ejecución."""

    now = datetime.now(timezone.utc)
    items: list[dict[str, Any]] = []
    async with control_session() as session:
        for event in body.events:
            statement = (
                pg_insert(WebhookInbox)
                .values(
                    provider="meta",
                    event_key=event.event_key,
                    connection_key=event.phone_number_id,
                    phone_number_id=event.phone_number_id,
                    event_type=event.event_type,
                    payload=event.payload,
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
                        WebhookInbox.event_key == event.event_key,
                    )
                )
            ).scalar_one()
            items.append(_item(existing, accepted=False))

    return {
        "items": items,
        "accepted": sum(1 for item in items if item["accepted"]),
        "duplicates": sum(1 for item in items if not item["accepted"]),
    }


@router.post("/meta-events/inbox/claim")
async def claim_meta_events(limit: int = 50) -> dict[str, Any]:
    """Reclama fallos y ejecuciones abandonadas para replay desde n8n."""

    limit = max(1, min(limit, MAX_BATCH_SIZE))
    now = datetime.now(timezone.utc)
    stale_before = now - STALE_PROCESSING_AFTER
    async with control_session() as session:
        rows = (
            await session.execute(
                select(WebhookInbox)
                .where(
                    WebhookInbox.provider == "meta",
                    WebhookInbox.attempts < MAX_ATTEMPTS,
                    or_(
                        WebhookInbox.status.in_(("received", "failed")),
                        (
                            (WebhookInbox.status == "processing")
                            & (WebhookInbox.processing_started_at < stale_before)
                        ),
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


@router.post("/meta-events/inbox/{inbox_id}/complete")
async def complete_meta_event(inbox_id: UUID, body: InboxCompletion) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    values: dict[str, Any] = {
        "status": body.status,
        "last_error": body.error if body.status == "failed" else None,
        "updated_at": now,
    }
    if body.status == "processed":
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
        status = result.scalar_one_or_none()
        if status is None:
            existing = await session.scalar(
                select(WebhookInbox.status).where(WebhookInbox.id == str(inbox_id))
            )
            if existing is None:
                raise HTTPException(status_code=404, detail="Evento no encontrado")
            status = existing

    return {"status": status, "id": str(inbox_id)}
