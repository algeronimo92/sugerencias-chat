"""Consultas del tablero comercial; reutilizan el contrato de tarjeta del chat."""

from sqlalchemy import func, select, true
from app.db.models.leads import Lead, LeadStage
from app.db.models.conversations import WspMessage
from app.modules.conversations.ports.chat_queries import _row_to_chat, _tags_by_lead

KANBAN_PAGE_SIZE = 40

from app.modules.conversations.ports.chat_queries import (_chat_columns, _chat_search_condition, _last_message_subquery, _matched_message_subquery, _search_rank_expression, _visible_lead_condition)
from app.db.uow import session_scope
async def _ordered_stage_keys(session) -> list[str]:
    """Claves de las etapas del negocio en el orden del embudo."""
    return list(
        (
            await session.execute(
                select(LeadStage.key).order_by(LeadStage.position.asc(), LeadStage.key.asc())
            )
        ).scalars().all()
    )


async def fetch_kanban_counts(search: str | None = None) -> dict[str, int]:
    """Conteos del embudo. Con búsqueda se aplica el mismo filtro que a las
    tarjetas, incluido el último mensaje, para que los encabezados coincidan."""
    last_message = _last_message_subquery()
    stmt = (
        select(Lead.estado, func.count(Lead.id))
        .join(last_message, true(), isouter=True)
        .where(await _visible_lead_condition())
        .group_by(Lead.estado)
    )
    if search:
        stmt = stmt.where(_chat_search_condition(search))

    async with session_scope() as session:
        stage_keys = await _ordered_stage_keys(session)
        rows = (await session.execute(stmt)).all()

    counts = {key: 0 for key in stage_keys}
    for stage, total in rows:
        counts[stage] = total
    return counts


async def fetch_kanban_snapshot(
    search: str | None = None,
    limit: int = KANBAN_PAGE_SIZE,
) -> dict:
    """Primera página de todas las columnas en una sola consulta.

    El conteo total viaja como una ventana por etapa, evitando las 14
    solicitudes (conteos + 13 columnas) que hacía la vista al abrirse.
    """
    last_message = _last_message_subquery()
    columns = list(_chat_columns(last_message))
    rank_order = [
        last_message.c.sent_at.desc().nulls_last(),
        Lead.updated_at.desc(),
        Lead.id.desc(),
    ]
    if search:
        columns.append(_search_rank_expression(search).label("search_rank"))
        columns.append(_matched_message_subquery(search).label("matched_message"))
        columns.append(_matched_message_subquery(search, WspMessage.id).label("matched_message_id"))
        rank_order.insert(0, _search_rank_expression(search).desc())
    ranked_stmt = (
        select(
            *columns,
            func.count().over(partition_by=Lead.estado).label("stage_total"),
            func.row_number().over(
                partition_by=Lead.estado,
                order_by=tuple(rank_order),
            ).label("stage_rank"),
        )
        .join(last_message, true(), isouter=True)
        .where(await _visible_lead_condition())
    )
    if search:
        ranked_stmt = ranked_stmt.where(_chat_search_condition(search))

    ranked = ranked_stmt.subquery()
    stmt = (
        select(ranked)
        .where(ranked.c.stage_rank <= limit)
        .order_by(ranked.c.stage, ranked.c.stage_rank)
    )

    async with session_scope() as session:
        stage_keys = await _ordered_stage_keys(session)
        rows = (await session.execute(stmt)).mappings().all()
        tags_by_lead = await _tags_by_lead(session, [row["chat_id"] for row in rows])

    # Una columna por cada etapa del negocio, aunque esté vacía o inactiva: el
    # frontend decide cuáles mostrar (las inactivas, solo si tienen leads).
    counts = {key: 0 for key in stage_keys}
    stages = {key: {"items": [], "has_more": False} for key in stage_keys}
    for row in rows:
        stage_key = row["stage"]
        counts[stage_key] = row["stage_total"]
        stages.setdefault(stage_key, {"items": [], "has_more": False})["items"].append(
            _row_to_chat(row, tags_by_lead.get(row["chat_id"]))
        )

    for stage_key, page in stages.items():
        page["has_more"] = counts[stage_key] > len(page["items"])
    return {"counts": counts, "stages": stages}


async def fetch_kanban_stage(
    stage: str,
    search: str | None = None,
    offset: int = 0,
    limit: int = KANBAN_PAGE_SIZE,
) -> dict:
    """Página independiente de una columna del Kanban. Esto evita renderizar
    los más de mil leads de la base en una sola carga."""
    last_message = _last_message_subquery()
    columns = list(_chat_columns(last_message))
    order_keys = [
        last_message.c.sent_at.desc().nulls_last(),
        Lead.updated_at.desc(),
        Lead.id.desc(),
    ]
    if search:
        columns.append(_search_rank_expression(search).label("search_rank"))
        columns.append(_matched_message_subquery(search).label("matched_message"))
        columns.append(_matched_message_subquery(search, WspMessage.id).label("matched_message_id"))
        order_keys.insert(0, _search_rank_expression(search).desc())
    stmt = (
        select(*columns)
        .join(last_message, true(), isouter=True)
        .where(Lead.estado == stage, await _visible_lead_condition())
    )
    if search:
        stmt = stmt.where(_chat_search_condition(search))

    stmt = stmt.order_by(*order_keys).offset(offset).limit(limit + 1)

    async with session_scope() as session:
        rows = (await session.execute(stmt)).mappings().all()
        page_rows = rows[:limit]
        tags_by_lead = await _tags_by_lead(session, [row["chat_id"] for row in page_rows])

    has_more = len(rows) > limit
    return {
        "items": [_row_to_chat(row, tags_by_lead.get(row["chat_id"])) for row in page_rows],
        "has_more": has_more,
    }
