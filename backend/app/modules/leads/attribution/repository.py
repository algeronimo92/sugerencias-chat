"""SQL de los clics (``wsp_ad``) y del libro mayor
(``meta_conversion_events``). Es el único lugar que escribe esas tablas."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert

from app.db.models.leads import MetaConversionEvent, WhatsappAdConversion
from app.db.uow import session_scope


async def insert_click(values: dict) -> int | None:
    """Guarda el clic; ``None`` si ese ``ctwaclid`` ya estaba (un reintento del
    webhook, o n8n lo guardó antes).

    No hay índice único que lo garantice (n8n ya dejó duplicados): un bloqueo
    por clic hasta el fin de la transacción ordena a dos entregas simultáneas
    del mismo webhook, y la segunda encuentra la fila de la primera."""
    async with session_scope() as session:
        await session.execute(
            select(func.pg_advisory_xact_lock(func.hashtext(values["ctwaclid"])))
        )
        exists = await session.scalar(
            select(WhatsappAdConversion.id).where(WhatsappAdConversion.ctwaclid == values["ctwaclid"]).limit(1)
        )
        if exists is not None:
            return None
        return await session.scalar(
            insert(WhatsappAdConversion).values(**values).returning(WhatsappAdConversion.id)
        )


async def last_click_before(lead_id: str, moment: datetime) -> int | None:
    """El último clic del lead anterior al hecho (último toque)."""
    when = func.coalesce(WhatsappAdConversion.fecha_interaccion, WhatsappAdConversion.created_at)
    async with session_scope() as session:
        return await session.scalar(
            select(WhatsappAdConversion.id)
            .where(
                WhatsappAdConversion.lead_id == lead_id,
                WhatsappAdConversion.ctwaclid.isnot(None),
                when <= moment,
            )
            .order_by(when.desc(), WhatsappAdConversion.id.desc())
            .limit(1)
        )


async def add_event(values: dict) -> bool:
    """Inserta el evento si su ``event_key`` no existe. Va en un savepoint:
    corre dentro de la transacción de la cita o del webhook, y un fallo acá
    no puede abortar esa transacción."""
    async with session_scope() as session:
        async with session.begin_nested():
            inserted = await session.scalar(
                insert(MetaConversionEvent)
                .values(**values)
                .on_conflict_do_nothing(index_elements=["event_key"])
                .returning(MetaConversionEvent.id)
            )
    return inserted is not None


async def claim_due(now: datetime, limit: int) -> list[dict]:
    """Reclama los pendientes vencidos con el clic que llevan. ``SKIP LOCKED``:
    dos workers (el solapamiento de un blue-green) no mandan la misma fila.
    El bloqueo dura lo que la sesión, que es la de la pasada."""
    async with session_scope() as session:
        rows = (await session.execute(
            select(
                MetaConversionEvent.id, MetaConversionEvent.lead_id, MetaConversionEvent.event_name,
                MetaConversionEvent.event_time, MetaConversionEvent.custom_data,
                MetaConversionEvent.attempts, WhatsappAdConversion.ctwaclid,
            )
            .join(WhatsappAdConversion, WhatsappAdConversion.id == MetaConversionEvent.wsp_ad_id)
            .where(MetaConversionEvent.status == "pending", MetaConversionEvent.next_attempt_at <= now)
            .order_by(MetaConversionEvent.next_attempt_at, MetaConversionEvent.id)
            .limit(limit)
            .with_for_update(of=MetaConversionEvent, skip_locked=True)
        )).mappings().all()
    return [dict(row) for row in rows]


async def mark(event_id: int, **values) -> None:
    async with session_scope() as session:
        await session.execute(
            update(MetaConversionEvent).where(MetaConversionEvent.id == event_id).values(**values)
        )
