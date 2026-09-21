"""Inbox durable para eventos de Meta recibidos por n8n.

n8n normaliza el sobre, registra cada evento aquí y recién entonces confirma
la recepción a Meta. El procesamiento ordinario y el replay usan el mismo
payload normalizado. Esta tabla pertenece al plano de control porque la
recepción ocurre antes de abrir el schema del número receptor.
"""

from typing import Any, Literal
from uuid import UUID

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field

from routers.webhooks.common import webhooks_router
from services.meta_inbox import (
    MAX_BATCH_SIZE,
    claim_meta_events as claim_meta_events_service,
    complete_meta_event as complete_meta_event_service,
    receive_meta_events as receive_meta_events_service,
)


router = webhooks_router()

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


@router.post("/meta-events/inbox")
async def receive_meta_events(body: MetaInboxBatch) -> dict[str, Any]:
    """Persiste eventos antes del ACK y reclama los nuevos para esta ejecución."""
    return await receive_meta_events_service(
        event.model_dump() for event in body.events
    )


@router.post("/meta-events/inbox/claim")
async def claim_meta_events(limit: int = 50) -> dict[str, Any]:
    """Reclama fallos y ejecuciones abandonadas para replay desde n8n."""

    return await claim_meta_events_service(limit)


@router.post("/meta-events/inbox/{inbox_id}/complete")
async def complete_meta_event(inbox_id: UUID, body: InboxCompletion) -> dict[str, Any]:
    status = await complete_meta_event_service(
        inbox_id, status=body.status, error=body.error
    )
    if status is None:
        raise HTTPException(status_code=404, detail="Evento no encontrado")

    return {"status": status, "id": str(inbox_id)}
