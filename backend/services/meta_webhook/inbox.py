"""Inbox durable de los webhooks de Meta, en el plano de control.

Cada ``entry[].changes[]`` del cuerpo verificado se guarda tal cual antes de
responder 200: si el proceso muere después, el worker lo retoma. El inbox vive
en ``public`` porque al recibir todavía no se sabe a qué negocio pertenece.

La clave de deduplicación es el hash del ``change`` completo: Meta reintenta
la entrega con el mismo contenido y ese reintento no se vuelve a procesar.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable
from uuid import UUID

from sqlalchemy import delete, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from db.models import WebhookInbox
from db.session import control_session

PROVIDER = "meta"
MAX_ATTEMPTS = 10
STALE_PROCESSING_AFTER = timedelta(minutes=5)
PROCESSED_RETENTION = timedelta(days=7)


@dataclass(frozen=True)
class InboxEvent:
    id: str
    event_type: str
    payload: dict[str, Any]
    attempts: int


def _event_key(change: dict[str, Any]) -> str:
    canonical = json.dumps(change, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    return f"{change['field']}:{hashlib.sha256(canonical.encode()).hexdigest()}"


def split_changes(body: dict[str, Any]) -> list[dict[str, Any]]:
    """Un registro por ``change``, con el ``entry`` que lo contiene.

    ``value`` se conserva sin modificar. ``entry_id`` es la WABA: los eventos
    de plantillas no traen ``phone_number_id`` y se rutean por ella.
    """
    changes: list[dict[str, Any]] = []
    for entry in body.get("entry") or []:
        if not isinstance(entry, dict):
            continue
        for change in entry.get("changes") or []:
            if not isinstance(change, dict) or not isinstance(change.get("field"), str):
                continue
            changes.append({
                "object": body.get("object"),
                "entry_id": entry.get("id"),
                "entry_time": entry.get("time"),
                "field": change["field"],
                "value": change.get("value"),
            })
    return changes


def _phone_number_id(change: dict[str, Any]) -> str | None:
    value = change.get("value")
    metadata = value.get("metadata") if isinstance(value, dict) else None
    phone_number_id = metadata.get("phone_number_id") if isinstance(metadata, dict) else None
    return phone_number_id if isinstance(phone_number_id, str) and phone_number_id else None


async def store_changes(changes: Iterable[dict[str, Any]]) -> tuple[list[str], int]:
    """Guarda los cambios nuevos y devuelve ``(ids nuevos, duplicados)``."""
    accepted: list[str] = []
    duplicates = 0
    async with control_session() as session:
        for change in changes:
            phone_number_id = _phone_number_id(change)
            entry_id = change.get("entry_id")
            statement = (
                pg_insert(WebhookInbox)
                .values(
                    provider=PROVIDER,
                    event_key=_event_key(change),
                    connection_key=phone_number_id or (str(entry_id) if entry_id else None),
                    phone_number_id=phone_number_id,
                    event_type=change["field"],
                    payload=change,
                    status="received",
                    attempts=0,
                )
                .on_conflict_do_nothing(index_elements=["provider", "event_key"])
                .returning(WebhookInbox.id)
            )
            inserted = (await session.execute(statement)).scalar_one_or_none()
            if inserted is None:
                duplicates += 1
            else:
                accepted.append(str(inserted))
    return accepted, duplicates


async def claim_events(limit: int, *, ids: list[str] | None = None) -> list[InboxEvent]:
    """Reclama eventos pendientes, fallidos o abandonados con skip-locked.

    Con ``ids`` reclama solo esos (el procesamiento inmediato tras recibir);
    sin ellos, cualquiera que esté listo (el barrido del worker).
    """
    now = datetime.now(timezone.utc)
    stale_before = now - STALE_PROCESSING_AFTER
    async with control_session() as session:
        conditions = [
            WebhookInbox.provider == PROVIDER,
            WebhookInbox.attempts < MAX_ATTEMPTS,
            or_(
                WebhookInbox.status.in_(("received", "failed")),
                (WebhookInbox.status == "processing")
                & (WebhookInbox.processing_started_at < stale_before),
            ),
        ]
        if ids is not None:
            conditions.append(WebhookInbox.id.in_(ids))
        rows = (
            await session.execute(
                select(WebhookInbox)
                .where(*conditions)
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
            InboxEvent(id=str(row.id), event_type=row.event_type, payload=row.payload, attempts=row.attempts)
            for row in rows
        ]


async def complete_event(event_id: str | UUID, *, error: str | None = None) -> None:
    now = datetime.now(timezone.utc)
    values: dict[str, Any] = {"updated_at": now}
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
