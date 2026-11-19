"""Las llamadas de WhatsApp en PostgreSQL.

Cada transición es un ``UPDATE ... WHERE status IN (...)`` que devuelve la
fila solo si la cambió: dos workers con el mismo evento, o dos personas
pulsando Atender a la vez, no producen dos efectos. Los índices únicos
parciales (una llamada viva por chat y una por agente) son la última
garantía.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import and_, cast, func, or_, select, update
from sqlalchemy.dialects.postgresql import JSONB, insert as pg_insert
from sqlalchemy.exc import IntegrityError

from app.db.models.conversations import WhatsAppCall
from app.db.uow import session_scope
from app.modules.conversations.domain import calls as rules

_LIVE = tuple(rules.LIVE_STATUSES)


def _row(call: WhatsAppCall | None) -> dict[str, Any] | None:
    if call is None:
        return None
    return {column.key: getattr(call, column.key) for column in WhatsAppCall.__table__.columns}


def _clean_event(event: dict) -> dict:
    """El evento sin la oferta SDP: no se guarda más allá de la llamada."""
    session = event.get("session") if isinstance(event.get("session"), dict) else None
    if session is None:
        return event
    return {**event, "session": {key: value for key, value in session.items() if key != "sdp"}}


class SqlCallStore:
    async def insert_ringing(self, **values: Any) -> tuple[dict, bool]:
        event = _clean_event(values.pop("event"))
        statement = (
            pg_insert(WhatsAppCall)
            .values(direction=rules.INBOUND, status=rules.RINGING, events=[event], **values)
            .on_conflict_do_nothing(
                index_elements=["wa_call_id"], index_where=WhatsAppCall.wa_call_id.is_not(None),
            )
            .returning(WhatsAppCall)
        )
        async with session_scope() as session:
            created = (await session.execute(statement)).scalar_one_or_none()
            if created is not None:
                return _row(created), True
            existing = await session.scalar(
                select(WhatsAppCall).where(WhatsAppCall.wa_call_id == values["wa_call_id"])
            )
            return _row(existing), False

    async def get(self, call_id: int) -> dict | None:
        async with session_scope() as session:
            return _row(await session.get(WhatsAppCall, call_id, populate_existing=True))

    async def get_by_wa_call_id(self, wa_call_id: str) -> dict | None:
        async with session_scope() as session:
            return _row(await session.scalar(select(WhatsAppCall).where(WhatsAppCall.wa_call_id == wa_call_id)))

    async def _transition(self, where: list, values: dict[str, Any]) -> dict | None:
        statement = update(WhatsAppCall).where(*where).values(**values).returning(WhatsAppCall)
        async with session_scope() as session:
            return _row((await session.execute(statement)).scalar_one_or_none())

    async def claim(self, call_id: int, *, user_id: int, client_id: str, until: datetime) -> dict | None:
        try:
            return await self._transition(
                [WhatsAppCall.id == call_id, WhatsAppCall.status == rules.RINGING],
                {
                    "status": rules.CONNECTING, "handled_by_user_id": user_id,
                    "claimed_by_client_id": client_id, "claim_expires_at": until,
                },
            )
        except IntegrityError as exc:
            # El índice de una llamada viva por agente.
            raise rules.AgentBusy() from exc

    async def release(self, call_id: int, *, user_id: int) -> dict | None:
        return await self._transition(
            [WhatsAppCall.id == call_id, WhatsAppCall.status == rules.CONNECTING, WhatsAppCall.handled_by_user_id == user_id],
            {"status": rules.RINGING, "handled_by_user_id": None, "claimed_by_client_id": None, "claim_expires_at": None},
        )

    async def mark_accepted(self, call_id: int, *, user_id: int, at: datetime) -> dict | None:
        return await self._transition(
            [WhatsAppCall.id == call_id, WhatsAppCall.status == rules.CONNECTING, WhatsAppCall.handled_by_user_id == user_id],
            {"status": rules.ACCEPTED, "accepted_at": at, "claim_expires_at": None},
        )

    async def finish(
        self, call_id: int, *, status: str, cause: str | None, error_code: str | None,
        ended_at: datetime, accepted_at: datetime | None, duration_seconds: int | None,
        closed_by: str | None,
    ) -> dict | None:
        # Viva, o cerrada localmente (quien colgó o el ciclo de limpieza) y
        # ahora llega el cierre de Meta, que trae la duración verdadera.
        closable = WhatsAppCall.status.in_(_LIVE)
        if closed_by is None:
            closable = or_(closable, WhatsAppCall.closed_by.is_not(None))
        return await self._transition(
            [WhatsAppCall.id == call_id, closable],
            {
                "status": status,
                # Si Meta no dice por qué, se conserva lo que informó el navegador.
                "cause": func.coalesce(cause, WhatsAppCall.cause) if cause is None else cause,
                "error_code": func.coalesce(error_code, WhatsAppCall.error_code),
                "ended_at": ended_at,
                "accepted_at": func.coalesce(accepted_at, WhatsAppCall.accepted_at),
                "duration_seconds": func.coalesce(duration_seconds, WhatsAppCall.duration_seconds),
                "closed_by": closed_by,
                "remote_sdp": None,
                "claim_expires_at": None,
            },
        )

    async def dismiss(self, call_id: int, user_id: int) -> dict | None:
        already = WhatsAppCall.dismissed_by.contains([user_id])
        return await self._transition(
            [WhatsAppCall.id == call_id, WhatsAppCall.status == rules.RINGING, ~already],
            {"dismissed_by": WhatsAppCall.dismissed_by.op("||")(func.jsonb_build_array(user_id))},
        )

    async def append_event(self, call_id: int, event: dict) -> None:
        statement = (
            update(WhatsAppCall).where(WhatsAppCall.id == call_id)
            .values(events=WhatsAppCall.events.op("||")(func.jsonb_build_array(cast(_clean_event(event), JSONB))))
        )
        async with session_scope() as session:
            await session.execute(statement)

    async def ringing(self) -> list[dict]:
        async with session_scope() as session:
            rows = (await session.scalars(
                select(WhatsAppCall).where(WhatsAppCall.status == rules.RINGING).order_by(WhatsAppCall.ringing_at)
            )).all()
        return [_row(row) for row in rows]

    async def for_chat(self, chat_id: str, limit: int) -> list[dict]:
        async with session_scope() as session:
            rows = (await session.scalars(
                select(WhatsAppCall).where(WhatsAppCall.chat_id == chat_id)
                .order_by(WhatsAppCall.ringing_at.desc()).limit(limit)
            )).all()
        return [_row(row) for row in rows]

    async def stale(self, *, ringing_before: datetime, claim_expired_at: datetime, accepted_before: datetime) -> list[dict]:
        condition = or_(
            and_(WhatsAppCall.status == rules.RINGING, WhatsAppCall.ringing_at < ringing_before),
            and_(WhatsAppCall.status == rules.CONNECTING, WhatsAppCall.claim_expires_at < claim_expired_at),
            and_(
                WhatsAppCall.status == rules.ACCEPTED,
                func.coalesce(WhatsAppCall.accepted_at, WhatsAppCall.ringing_at) < accepted_before,
            ),
        )
        async with session_scope() as session:
            rows = (await session.scalars(select(WhatsAppCall).where(condition).limit(100))).all()
        return [_row(row) for row in rows]
