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

from sqlalchemy import and_, delete, func, or_, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.db.models.control import WebhookInbox
from app.db.session import control_session

PROVIDER = "meta"
MAX_ATTEMPTS = 10
STALE_PROCESSING_AFTER = timedelta(minutes=5)
PROCESSED_RETENTION = timedelta(days=7)


# Las llamadas van por un carril propio (docs/analisis/17-plan-llamadas-whatsapp.md,
# §4.1): el cliente escucha el tono y Meta da entre 30 y 60 s para atender,
# así que no pueden esperar detrás de la descarga de un video.
CALLS_EVENT_TYPE = "calls"


@dataclass(frozen=True)
class Lane:
    """Qué eventos toma un ciclo del worker y cómo los reintenta."""

    name: str
    # Solo estos tipos, o todos menos estos.
    only: frozenset[str] | None
    exclude: frozenset[str]
    stale_after: timedelta
    # Espera mínima entre intentos de un evento fallido; None reintenta enseguida.
    retry_backoff: timedelta | None


MESSAGES_LANE = Lane(
    name="messages", only=None, exclude=frozenset({CALLS_EVENT_TYPE}),
    stale_after=STALE_PROCESSING_AFTER, retry_backoff=None,
)
# Un evento de llamada abandonado se retoma enseguida (pasados 5 minutos la
# llamada ya terminó), y uno fallido espera entre intentos: reintentar sin
# pausa quemaba los diez intentos en un corte breve de la base y la llamada
# no sonaba nunca.
CALLS_LANE = Lane(
    name="calls", only=frozenset({CALLS_EVENT_TYPE}), exclude=frozenset(),
    stale_after=timedelta(seconds=15), retry_backoff=timedelta(seconds=1),
)


@dataclass(frozen=True)
class InboxEvent:
    id: str
    event_type: str
    payload: dict[str, Any]
    attempts: int
    # Cuándo lo guardó el webhook, con el reloj propio y no el de Meta: decide
    # si una llamada ya es vieja para hacer sonar a alguien.
    received_at: datetime | None = None


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


async def claim_events(
    limit: int, *, ids: list[str] | None = None, lane: Lane = MESSAGES_LANE,
) -> list[InboxEvent]:
    """Reclama eventos pendientes, fallidos o abandonados con skip-locked.

    Con ``ids`` reclama solo esos (el procesamiento inmediato tras recibir);
    sin ellos, cualquiera que esté listo (el barrido del worker). ``lane``
    dice qué tipos toma y con qué reglas.
    """
    now = datetime.now(timezone.utc)
    stale_before = now - lane.stale_after
    failed_ready = WebhookInbox.status == "failed"
    if lane.retry_backoff is not None:
        # La espera crece con cada intento: 1 s, 2 s, 3 s... desde el último.
        # Se calcula en la base: la resta de un intervalo por una columna
        # no tiene un tipo que el driver sepa enviar como parámetro.
        wait = func.make_interval(
            0, 0, 0, 0, 0, 0, lane.retry_backoff.total_seconds() * func.greatest(WebhookInbox.attempts, 1),
        )
        failed_ready = failed_ready & (WebhookInbox.updated_at < func.now() - wait)
    async with control_session() as session:
        conditions = [
            WebhookInbox.provider == PROVIDER,
            WebhookInbox.attempts < MAX_ATTEMPTS,
            or_(
                WebhookInbox.status == "received",
                failed_ready,
                (WebhookInbox.status == "processing")
                & (WebhookInbox.processing_started_at < stale_before),
            ),
        ]
        if lane.only is not None:
            conditions.append(WebhookInbox.event_type.in_(sorted(lane.only)))
        if lane.exclude:
            conditions.append(WebhookInbox.event_type.not_in(sorted(lane.exclude)))
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
            InboxEvent(
                id=str(row.id), event_type=row.event_type, payload=row.payload,
                attempts=row.attempts, received_at=row.received_at,
            )
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


async def release_event(event_id: str | UUID) -> None:
    """Devuelve un evento reclamado sin contarlo como intento: el proceso se
    está apagando (un deploy) y otro worker lo toma enseguida, en vez de
    esperar a que venza el reclamo."""
    now = datetime.now(timezone.utc)
    async with control_session() as session:
        await session.execute(
            update(WebhookInbox)
            .where(
                WebhookInbox.id == str(event_id), WebhookInbox.provider == PROVIDER,
                WebhookInbox.status == "processing",
            )
            .values(
                status="received", attempts=func.greatest(WebhookInbox.attempts - 1, 0),
                processing_started_at=None, updated_at=now,
            )
        )


async def replace_payload(event_id: str | UUID, payload: dict[str, Any]) -> None:
    """Reescribe el cuerpo guardado de un evento ya procesado. Lo usan las
    llamadas para no dejar la oferta SDP en el inbox los días de retención."""
    async with control_session() as session:
        await session.execute(
            update(WebhookInbox)
            .where(WebhookInbox.id == str(event_id), WebhookInbox.provider == PROVIDER)
            .values(payload=payload)
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
        # Los que agotaron sus intentos también se van con la misma retención:
        # antes quedaban para siempre, y un evento de llamada guarda teléfonos
        # y la oferta SDP.
        await session.execute(
            delete(WebhookInbox).where(
                WebhookInbox.provider == PROVIDER,
                WebhookInbox.status == "failed",
                WebhookInbox.attempts >= MAX_ATTEMPTS,
                WebhookInbox.updated_at < cutoff,
            )
        )


@dataclass(frozen=True)
class InboxStats:
    # Esperando, en curso o fallidos que todavía se van a reintentar.
    pending: int
    # Agotaron sus intentos: el mensaje del paciente no llegó al CRM.
    exhausted: int
    exhausted_last_hour: int
    oldest_pending_age_seconds: float


async def inbox_stats() -> InboxStats:
    now = datetime.now(timezone.utc)
    pending = or_(
        WebhookInbox.status.in_(("received", "processing")),
        and_(WebhookInbox.status == "failed", WebhookInbox.attempts < MAX_ATTEMPTS),
    )
    exhausted = and_(WebhookInbox.status == "failed", WebhookInbox.attempts >= MAX_ATTEMPTS)
    async with control_session() as session:
        row = (
            await session.execute(
                select(
                    func.count().filter(pending),
                    func.count().filter(exhausted),
                    func.count().filter(exhausted, WebhookInbox.updated_at >= now - timedelta(hours=1)),
                    func.min(WebhookInbox.received_at).filter(pending),
                ).where(WebhookInbox.provider == PROVIDER)
            )
        ).one()
    oldest = row[3]
    return InboxStats(
        pending=row[0] or 0,
        exhausted=row[1] or 0,
        exhausted_last_hour=row[2] or 0,
        oldest_pending_age_seconds=max(0.0, (now - oldest).total_seconds()) if oldest else 0.0,
    )
