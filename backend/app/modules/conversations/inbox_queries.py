"""Lado de lectura de la bandeja: qué falta ver."""

from sqlalchemy import func, or_, select, true

from app.db.models.leads import Lead
from app.db.models.conversations import WspMessage
from app.db.uow import session_scope
from app.modules.conversations.chat_queries import (
    LeadFilters,
    _apply_lead_filters,
    _has_unread_messages_condition,
    _last_message_subquery,
    _visible_lead_condition,
    owner_condition,
)


async def fetch_unread_wa_message_ids(chat_id: str) -> list[str]:
    """IDs de WhatsApp de los mensajes del cliente sin ver en este chat, para
    marcarlos como leídos en Meta. Hay que llamar esto ANTES de
    mark_chat_read: una vez actualizado last_read_at, estos mensajes dejan de
    contar como "sin ver"."""
    stmt = (
        select(WspMessage.wa_message_id)
        .join(Lead, Lead.id == WspMessage.chat_id)
        .where(
            WspMessage.chat_id == chat_id,
            WspMessage.sender == "cliente",
            WspMessage.wa_message_id.is_not(None),
            WspMessage.wa_message_id != "",
            or_(Lead.last_read_at.is_(None), WspMessage.sent_at > Lead.last_read_at),
        )
    )
    async with session_scope() as session:
        return list((await session.execute(stmt)).scalars().all())


async def fetch_total_unread_chat_count(owner_id: int | None = None) -> int:
    """Total de chats con al menos un mensaje de cliente aún no visto.

    Solo los que la lista puede mostrar: mismo criterio de visibilidad y de
    "no leído" que el filtro de la bandeja. Un chat de otro número (una
    instancia vieja) nunca se puede abrir para marcarlo como visto, y sumarlo
    dejaba el contador en "+99" con el filtro vacío.
    """
    stmt = (
        select(func.count(Lead.id))
        .where(await _visible_lead_condition(), _has_unread_messages_condition(), owner_condition(owner_id))
    )
    async with session_scope() as session:
        return (await session.execute(stmt)).scalar_one()


async def fetch_inbox_counts(filters: LeadFilters, user_id: int) -> dict:
    """Cuántos chats hay en cada bandeja del panel lateral (doc 18 §6.1).

    Respeta los mismos filtros que la lista (`filters`), así los números
    coinciden con lo que se ve al tocar cada bandeja. Quien los pide no manda
    el filtro de la bandeja misma: con `unassigned` activo, "Mías" daría 0.
    Todo sale en dos consultas (bandejas y etapas) con COUNT(*) FILTER, en
    vez de una por bandeja.
    """
    last_message = _last_message_subquery()
    base = (
        select(Lead.id, Lead.estado, Lead.vendedor_id, Lead.conversacion_abierta,
               _has_unread_messages_condition().label("unread"),
               (last_message.c.sender == "cliente").label("waiting"))
        .join(last_message, true(), isouter=True)
        .where(await _visible_lead_condition())
    )
    rows = _apply_lead_filters(base, last_message, filters).subquery()

    def count_where(condition):
        return func.count().filter(condition)

    inboxes = select(
        func.count().label("all"),
        count_where(rows.c.unread).label("unread"),
        count_where(rows.c.vendedor_id == user_id).label("mine"),
        count_where(rows.c.vendedor_id.is_(None)).label("unassigned"),
        count_where(rows.c.conversacion_abierta.is_(True)).label("open"),
        count_where(rows.c.conversacion_abierta.is_(False)).label("closed"),
        count_where(rows.c.waiting.is_(True)).label("waiting"),
    )
    stages = select(rows.c.estado, func.count()).group_by(rows.c.estado)
    async with session_scope() as session:
        counts = dict((await session.execute(inboxes)).mappings().one())
        counts["stages"] = {stage: total for stage, total in (await session.execute(stages)).all() if stage}
    return counts
