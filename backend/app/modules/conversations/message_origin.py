"""Agrega a cada mensaje servido su ``origin`` (ver domain/origin.py).

El hilo paginado ya trae los hechos en su propia consulta (une el outbox);
las mutaciones que devuelven un mensaje suelto los cargan acá en una consulta
por los ids. En los dos casos los nombres de las personas se resuelven con una
sola consulta a ``auth`` por lote, sin filtrar inactivos: el historial tiene
que seguir diciendo quién mandó algo aunque ya no esté en el equipo.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from typing import Any

from sqlalchemy import select

from app.db.models.conversations import MessageOutbox, WspMessage
from app.db.uow import session_scope
from app.modules.auth.public import User, user_names
from app.modules.conversations.domain.origin import MessageOriginKind, classify_origin


@dataclass(frozen=True)
class OriginFacts:
    sender: str | None
    sent_by_user_id: int | None
    has_outbox: bool
    dedupe_key: str | None


def facts_from_row(row: Mapping[str, Any]) -> OriginFacts:
    """Hechos de una fila del hilo que ya une ``message_outbox`` (columnas
    ``sender``, ``sent_by_user_id``, ``outbox_id`` y ``dedupe_key``)."""
    return OriginFacts(
        sender=row["sender"],
        sent_by_user_id=row["sent_by_user_id"],
        has_outbox=row["outbox_id"] is not None,
        dedupe_key=row["dedupe_key"],
    )


async def load_origin_facts(message_ids: Iterable[int]) -> dict[int, OriginFacts]:
    wanted = {int(message_id) for message_id in message_ids}
    if not wanted:
        return {}
    stmt = (
        select(
            WspMessage.id,
            WspMessage.sender,
            WspMessage.sent_by_user_id,
            MessageOutbox.id.label("outbox_id"),
            MessageOutbox.dedupe_key,
        )
        .outerjoin(MessageOutbox, MessageOutbox.message_id == WspMessage.id)
        .where(WspMessage.id.in_(wanted))
    )
    async with session_scope() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return {row["id"]: facts_from_row(row) for row in rows}


async def attach_origins(items: list[dict], facts: Mapping[int, OriginFacts] | None = None) -> list[dict]:
    """Devuelve los mismos mensajes con ``origin`` resuelto (nombre incluido).

    Sin ``facts`` los carga por id. Un mensaje sin hechos (no debería pasar)
    queda con ``origin`` en ``None``, igual que uno del cliente.
    """
    if not items:
        return items
    if facts is None:
        facts = await load_origin_facts(item["id"] for item in items)
    origins: dict[int, dict | None] = {}
    for item in items:
        known = facts.get(item["id"])
        origins[item["id"]] = None if known is None else classify_origin(
            sender=known.sender,
            sent_by_user_id=known.sent_by_user_id,
            has_outbox=known.has_outbox,
            dedupe_key=known.dedupe_key,
        )
    names = await user_names(
        origin["user_id"] for origin in origins.values() if origin and origin["user_id"] is not None
    )
    return [
        {
            **item,
            "origin": None if origins[item["id"]] is None else {
                **origins[item["id"]],
                "user_name": names.get(origins[item["id"]]["user_id"]),
            },
        }
        for item in items
    ]


async def attach_origin(item: dict) -> dict:
    [enriched] = await attach_origins([item])
    return enriched


def with_user_origin(item: dict, user: User) -> dict:
    """Un envío que acaba de hacer ``user`` desde la app: el origen se conoce
    sin volver a la base."""
    return {
        **item,
        "origin": {
            "kind": MessageOriginKind.USER,
            "user_id": user.id,
            # El nombre es cosmético: un usuario autenticado siempre lo trae,
            # pero no vale la pena romper un envío si faltara.
            "user_name": getattr(user, "name", None),
            "execution_id": None,
        },
    }
