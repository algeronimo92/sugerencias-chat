import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, case, exists, false, func, or_, select, true

from db.models import (
    Lead,
    LeadStage,
    LeadTag,
    LeadTagAssignment,
    User,
    WhatsAppIdentity,
    WspMessage,
)
from db.session import get_sessionmaker
from services.settings_service import get_effective
from services.store.common import (
    CHATS_PAGE_SIZE,
    CUSTOMER_SERVICE_WINDOW,
    KANBAN_PAGE_SIZE,
    _fmt_ts,
    _parse_ts,
    _row_to_chat,
    _tags_by_lead,
)


def _last_message_subquery():
    """Último mensaje por chat vía LATERAL JOIN, evita un N+1 por lead.
    Incluye sender: el frontend lo usa para saber si el chat quedó
    "esperando respuesta" (último mensaje del cliente) o no (vendedor)."""
    return (
        select(
            WspMessage.content,
            WspMessage.sent_at,
            WspMessage.sender,
            WspMessage.message_type,
            WspMessage.deleted_at,
        )
        .where(WspMessage.chat_id == Lead.id)
        .order_by(WspMessage.sent_at.desc())
        .limit(1)
        .lateral()
    )


def _unread_count_subquery():
    """Mensajes del cliente posteriores a la última vez que se abrió el chat
    (o todos, si nunca se abrió) — el badge de "no vistos" de ChatList."""
    return (
        select(func.count(WspMessage.id))
        .where(
            WspMessage.chat_id == Lead.id,
            WspMessage.sender == "cliente",
            or_(Lead.last_read_at.is_(None), WspMessage.sent_at > Lead.last_read_at),
        )
        .correlate(Lead)
        .scalar_subquery()
    )


def _has_unread_messages_condition():
    """EXISTS correlacionado para filtrar leads sin contar todos sus mensajes."""
    return exists(
        select(WspMessage.id)
        .where(
            WspMessage.chat_id == Lead.id,
            WspMessage.sender == "cliente",
            or_(Lead.last_read_at.is_(None), WspMessage.sent_at > Lead.last_read_at),
        )
        .correlate(Lead)
    )


def _last_customer_message_at_subquery():
    return (
        select(func.max(WspMessage.sent_at))
        .where(WspMessage.chat_id == Lead.id, WspMessage.sender == "cliente")
        .correlate(Lead)
        .scalar_subquery()
    )


def _has_tag_condition(tag_id: int):
    return exists(
        select(LeadTagAssignment.tag_id)
        .join(LeadTag, LeadTag.id == LeadTagAssignment.tag_id)
        .where(
            LeadTagAssignment.lead_id == Lead.id,
            LeadTagAssignment.tag_id == tag_id,
            LeadTag.is_active == true(),
        )
        .correlate(Lead)
    )


async def _visible_lead_condition():
    """Un lead solo se lista si tiene un alias de la instancia de WhatsApp
    activa (o el `"*"` sintético de los leads creados a mano).

    Al migrar de instancia (nuevo número/reconexión), `_resolve_once` crea
    leads nuevos a propósito en vez de fusionarlos con los de la instancia
    anterior — ver `services.whatsapp_identity_service`. Sin este filtro esos
    leads viejos quedan mezclados para siempre con los de la instancia en
    uso. Si no hay ninguna instancia configurada no se filtra nada: no hay
    forma de saber cuál es "la activa".
    """
    active_instance = await get_effective("evolution_instance")
    if not active_instance:
        return true()
    return exists(
        select(WhatsAppIdentity.id)
        .where(
            WhatsAppIdentity.lead_id == Lead.id,
            WhatsAppIdentity.instance.in_((active_instance, "*")),
        )
        .correlate(Lead)
    )


def _escape_like(search: str) -> str:
    """Escapa los wildcards de LIKE para que '100%' o 'user_1' se busquen
    como texto literal y no como patrón."""
    return search.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# f_unaccent la instala el startup (o la migración 020). Si la base no lo
# permitió, el flag queda en False y la búsqueda degrada a ILIKE con acentos.
_unaccent_enabled = True


def set_unaccent_enabled(enabled: bool) -> None:
    global _unaccent_enabled
    _unaccent_enabled = enabled


def _unaccent_ilike(column, pattern: str):
    # Matching insensible a acentos ("jose" encuentra "José"), como la
    # búsqueda de WhatsApp.
    if _unaccent_enabled:
        return func.f_unaccent(column).ilike(func.f_unaccent(pattern), escape="\\")
    return column.ilike(pattern, escape="\\")


def _identity_conditions(search: str) -> list:
    """Nombre/teléfono/JID del lead: lo que busca el usuario la mayoría de
    las veces, y lo que WhatsApp muestra primero."""
    pattern = f"%{_escape_like(search)}%"
    conditions = [
        exists(select(WhatsAppIdentity.id).where(
            WhatsAppIdentity.lead_id == Lead.id,
            WhatsAppIdentity.jid.ilike(pattern, escape="\\"),
        )),
        Lead.telefono.ilike(pattern, escape="\\"),
        Lead.telefono_secundario.ilike(pattern, escape="\\"),
        _unaccent_ilike(Lead.nombre, pattern),
    ]

    # Teléfonos: comparar solo dígitos contra solo dígitos, para que
    # "1112345678" encuentre "+54 9 11 1234-5678" sin importar el formato.
    digits = re.sub(r"\D", "", search)
    if len(digits) >= 5:
        digits_pattern = f"%{digits}%"
        conditions.append(
            func.regexp_replace(Lead.telefono, r"\D", "", "g").like(digits_pattern)
        )
        conditions.append(
            func.regexp_replace(Lead.telefono_secundario, r"\D", "", "g").like(digits_pattern)
        )
        conditions.append(exists(select(WhatsAppIdentity.id).where(
            WhatsAppIdentity.lead_id == Lead.id,
            func.regexp_replace(WhatsAppIdentity.jid, r"\D", "", "g").like(digits_pattern),
        )))
    return conditions


def _crm_field_conditions(search: str) -> list:
    """Campos CRM (vendedor/servicio/origen). Siguen siendo buscables, pero
    rankean debajo de los matches por nombre: si no, buscar el nombre de un
    vendedor entierra al lead que se llama igual bajo todos sus asignados."""
    pattern = f"%{_escape_like(search)}%"
    return [
        _unaccent_ilike(Lead.servicio_interes, pattern),
        _unaccent_ilike(
            func.coalesce(
                select(User.name).where(User.id == Lead.vendedor_id).scalar_subquery(),
                Lead.vendedor,
            ),
            pattern,
        ),
        _unaccent_ilike(Lead.origen, pattern),
    ]


def _lead_field_conditions(search: str) -> list:
    return _identity_conditions(search) + _crm_field_conditions(search)


def _message_text_match(search: str):
    """Un mensaje matchea si el término aparece en su texto humano o en el
    resumen del análisis IA del adjunto. Lo segundo es lo que hace que buscar
    "yape" encuentre el comprobante cuya descripción generó la IA, aunque el
    cliente no haya escrito nada. El índice trigram sobre
    f_unaccent(analysis->>'summary') (idx_wsp_messages_analysis_trgm) evita el
    recorrido completo.

    Los eliminados quedan fuera: su texto ya no se sirve en ningún lado, así
    que tampoco puede aparecer como preview de un resultado de búsqueda."""
    pattern = f"%{_escape_like(search)}%"
    return and_(
        WspMessage.deleted_at.is_(None),
        or_(
            _unaccent_ilike(WspMessage.content, pattern),
            _unaccent_ilike(WspMessage.analysis["summary"].astext, pattern),
        ),
    )


def _message_match_condition(search: str):
    """Historial completo del chat, no solo el último mensaje: en WhatsApp
    un chat aparece aunque el término esté en un mensaje viejo."""
    return exists(
        select(WspMessage.id)
        .where(
            WspMessage.chat_id == Lead.id,
            _message_text_match(search),
        )
        .correlate(Lead)
    )


def _chat_search_condition(search: str):
    return or_(*_lead_field_conditions(search), _message_match_condition(search))


def _search_rank_expression(search: str):
    """Sección del resultado, como WhatsApp: 2 = match por nombre/teléfono,
    1 = match por campos CRM (vendedor/servicio/origen), 0 = solo por un
    mensaje del historial. Los coalesce evitan que un NULL (p. ej. nombre
    vacío) descoloque la fila en el ORDER BY."""
    return case(
        (func.coalesce(or_(*_identity_conditions(search)), false()), 2),
        (func.coalesce(or_(*_crm_field_conditions(search)), false()), 1),
        else_=0,
    )


def _matched_message_subquery(search: str, column=None):
    """Mensaje más reciente que contiene el término: su contenido se muestra
    en el preview del resultado (como WhatsApp) y su id permite saltar hasta
    él al abrir la conversación."""
    if column is None:
        # Preview del resultado: se muestra el campo que realmente contiene el
        # término, para que el resaltado lo encuentre. Si el match fue en el
        # análisis IA (p. ej. audios, donde `content` es NULL), se muestra ese
        # resumen en lugar de un preview vacío.
        pattern = f"%{_escape_like(search)}%"
        column = case(
            (_unaccent_ilike(WspMessage.content, pattern), WspMessage.content),
            else_=WspMessage.analysis["summary"].astext,
        )
    return (
        select(column)
        .where(
            WspMessage.chat_id == Lead.id,
            _message_text_match(search),
        )
        .order_by(WspMessage.sent_at.desc())
        .limit(1)
        .correlate(Lead)
        .scalar_subquery()
    )


def _chat_columns(last_message):
    seller_name = select(User.name).where(User.id == Lead.vendedor_id).scalar_subquery()
    return (
        Lead.id.label("chat_id"),
        Lead.telefono.label("phone"),
        Lead.telefono_secundario.label("secondary_phone"),
        Lead.nombre.label("name"),
        Lead.servicio_interes,
        Lead.vendedor_id,
        func.coalesce(seller_name, Lead.vendedor).label("vendedor"),
        Lead.origen,
        Lead.notas,
        Lead.estado.label("stage"),
        Lead.con_especialista,
        Lead.automatizacion_pausada,
        Lead.conversacion_abierta,
        Lead.conversacion_abierta_at,
        Lead.conversacion_cerrada_at,
        Lead.conversacion_version,
        Lead.razon_perdido,
        Lead.fecha_recontacto,
        Lead.proxima_cita,
        Lead.contador_noshow,
        Lead.toques_seguimiento,
        Lead.fecha_ultimo_toque,
        last_message.c.content.label("last_message"),
        last_message.c.sender.label("last_message_sender"),
        last_message.c.message_type.label("last_message_type"),
        last_message.c.deleted_at.label("last_message_deleted_at"),
        last_message.c.sent_at.label("timestamp"),
        _last_customer_message_at_subquery().label("last_customer_message_at"),
        _unread_count_subquery().label("unread_count"),
        Lead.last_read_at,
        Lead.last_automated_reply_at,
    )


def _cursor_condition(last_message, cursor_ts: str | None, cursor_id: str):
    """Condición de paginación por keyset sobre el mismo orden de la consulta
    (last_message.sent_at DESC NULLS LAST, leads.id DESC).

    cursor_ts/cursor_id identifican la última fila de la página anterior;
    se piden las filas que la siguen en ese orden. A diferencia de OFFSET,
    esto no se desalinea si un chat sube al tope por un mensaje nuevo entre
    una página y la siguiente.
    """
    if cursor_ts is not None:
        parsed_ts = _parse_ts(cursor_ts)
        return or_(
            last_message.c.sent_at < parsed_ts,
            and_(last_message.c.sent_at == parsed_ts, Lead.id < cursor_id),
            last_message.c.sent_at.is_(None),
        )
    # La fila cursor ya estaba en la cola de timestamp nulo: solo quedan
    # otras filas sin mensajes, desempatadas por el id interno.
    return and_(last_message.c.sent_at.is_(None), Lead.id < cursor_id)


async def fetch_chats(
    search: str | None = None,
    cursor_ts: str | None = None,
    cursor_id: str | None = None,
    limit: int = CHATS_PAGE_SIZE,
    unread_only: bool = False,
    stages: list[LeadStage] | None = None,
    tag_ids: list[int] | None = None,
    tag_mode: str = "any",
    service: str | None = None,
    seller_id: int | None = None,
    origin: str | None = None,
    last_sender: str | None = None,
    inactive_days: int | None = None,
    waiting_time: str | None = None,
    cursor_rank: int | None = None,
    automation_paused: bool = False,
) -> dict:
    last_message = _last_message_subquery()

    columns = list(_chat_columns(last_message))
    if search:
        columns.append(_search_rank_expression(search).label("search_rank"))
        columns.append(_matched_message_subquery(search).label("matched_message"))
        columns.append(_matched_message_subquery(search, WspMessage.id).label("matched_message_id"))

    stmt = (
        select(*columns)
        .join(last_message, true(), isouter=True)
        .where(await _visible_lead_condition())
    )

    if search:
        stmt = stmt.where(_chat_search_condition(search))

    if unread_only:
        stmt = stmt.where(_has_unread_messages_condition())

    if automation_paused:
        stmt = stmt.where(Lead.automatizacion_pausada.is_(True))

    if stages:
        stmt = stmt.where(Lead.estado.in_(stages))
    if tag_ids:
        tag_conditions = [_has_tag_condition(tag_id) for tag_id in tag_ids]
        stmt = stmt.where(and_(*tag_conditions) if tag_mode == "all" else or_(*tag_conditions))
    if service:
        stmt = stmt.where(Lead.servicio_interes.ilike(f"%{service}%"))
    if seller_id is not None:
        stmt = stmt.where(Lead.vendedor_id == seller_id)
    if origin:
        stmt = stmt.where(Lead.origen.ilike(f"%{origin}%"))
    if last_sender in ("cliente", "vendedor"):
        stmt = stmt.where(last_message.c.sender == last_sender)
    if inactive_days is not None and inactive_days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=inactive_days)
        stmt = stmt.where(or_(last_message.c.sent_at < cutoff, last_message.c.sent_at.is_(None)))
    if waiting_time in ("any", "fresh", "warning", "urgent"):
        now = datetime.now(timezone.utc)
        warning_cutoff = now - timedelta(minutes=10)
        urgent_cutoff = now - timedelta(hours=1)
        stmt = stmt.where(last_message.c.sender == "cliente")
        if waiting_time == "fresh":
            stmt = stmt.where(last_message.c.sent_at > warning_cutoff)
        elif waiting_time == "warning":
            stmt = stmt.where(
                last_message.c.sent_at <= warning_cutoff,
                last_message.c.sent_at > urgent_cutoff,
            )
        elif waiting_time == "urgent":
            stmt = stmt.where(last_message.c.sent_at <= urgent_cutoff)

    if cursor_id is not None:
        base_cursor = _cursor_condition(last_message, cursor_ts, cursor_id)
        if search:
            # El orden con búsqueda antepone search_rank DESC; el cursor
            # necesita saber en qué sección quedó la última fila. Sin
            # cursor_rank (cliente viejo) se asume la sección de arriba.
            rank = _search_rank_expression(search)
            section = cursor_rank if cursor_rank is not None else 2
            stmt = stmt.where(or_(rank < section, and_(rank == section, base_cursor)))
        else:
            stmt = stmt.where(base_cursor)

    # Se pide una fila de más para saber si hay página siguiente sin un
    # COUNT(*) aparte; se descarta antes de devolver los resultados.
    order_keys = [last_message.c.sent_at.desc().nulls_last(), Lead.id.desc()]
    if search:
        # Como WhatsApp: primero los chats cuyo nombre/datos matchean, después
        # los que solo matchean por un mensaje del historial.
        order_keys.insert(0, _search_rank_expression(search).desc())
    stmt = stmt.order_by(*order_keys).limit(limit + 1)

    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
        page_rows = rows[:limit]
        tags_by_lead = await _tags_by_lead(session, [row["chat_id"] for row in page_rows])

    has_more = len(rows) > limit
    return {
        "items": [_row_to_chat(row, tags_by_lead.get(row["chat_id"])) for row in page_rows],
        "has_more": has_more,
    }


async def fetch_chat(chat_id: str) -> dict | None:
    last_message = _last_message_subquery()
    stmt = (
        select(*_chat_columns(last_message))
        .join(last_message, true(), isouter=True)
        .where(Lead.id == chat_id)
    )
    async with get_sessionmaker()() as session:
        row = (await session.execute(stmt)).mappings().first()
        tags_by_lead = await _tags_by_lead(session, [chat_id]) if row is not None else {}

    return _row_to_chat(row, tags_by_lead.get(chat_id)) if row is not None else None


async def get_customer_service_window(chat_id: str) -> dict | None:
    last_customer_message = (
        select(func.max(WspMessage.sent_at))
        .where(
            WspMessage.chat_id == Lead.id,
            WspMessage.sender == "cliente",
        )
        .correlate(Lead)
        .scalar_subquery()
    )
    async with get_sessionmaker()() as session:
        row = (await session.execute(
            select(Lead.id, last_customer_message.label("last_customer_message_at"))
            .where(Lead.id == chat_id)
        )).mappings().one_or_none()
    if row is None:
        return None
    last_customer_message_at = row["last_customer_message_at"]

    now = datetime.now(timezone.utc)
    expires_at = last_customer_message_at + CUSTOMER_SERVICE_WINDOW if last_customer_message_at else None
    seconds_remaining = max(0, int((expires_at - now).total_seconds())) if expires_at else 0
    return {
        "is_open": seconds_remaining > 0,
        "last_customer_message_at": _fmt_ts(last_customer_message_at),
        "expires_at": _fmt_ts(expires_at),
        "seconds_remaining": seconds_remaining,
    }


async def lead_exists(chat_id: str) -> bool:
    """Validación ligera para operaciones que no necesitan la ventana de servicio."""
    stmt = select(exists().where(Lead.id == chat_id))
    async with get_sessionmaker()() as session:
        return bool(await session.scalar(stmt))


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

    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).all()

    counts = {stage.value: 0 for stage in LeadStage}
    for stage, total in rows:
        counts[stage.value if isinstance(stage, LeadStage) else stage] = total
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

    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
        tags_by_lead = await _tags_by_lead(session, [row["chat_id"] for row in rows])

    counts = {stage.value: 0 for stage in LeadStage}
    stages = {
        stage.value: {"items": [], "has_more": False}
        for stage in LeadStage
    }
    for row in rows:
        stage = row["stage"]
        stage_key = stage.value if isinstance(stage, LeadStage) else stage
        counts[stage_key] = row["stage_total"]
        stages[stage_key]["items"].append(
            _row_to_chat(row, tags_by_lead.get(row["chat_id"]))
        )

    for stage_key, page in stages.items():
        page["has_more"] = counts[stage_key] > len(page["items"])
    return {"counts": counts, "stages": stages}


async def fetch_kanban_stage(
    stage: LeadStage,
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

    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
        page_rows = rows[:limit]
        tags_by_lead = await _tags_by_lead(session, [row["chat_id"] for row in page_rows])

    has_more = len(rows) > limit
    return {
        "items": [_row_to_chat(row, tags_by_lead.get(row["chat_id"])) for row in page_rows],
        "has_more": has_more,
    }
