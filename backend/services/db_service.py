import asyncio
import re
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, case, delete, exists, false, func, insert, or_, select, true, update
from sqlalchemy.exc import IntegrityError

from domain_types import AutomationTrigger
from db.models import Lead, LeadActivity, LeadStage, LeadTag, LeadTagAssignment, User, WspMessage
from db.session import get_sessionmaker

CHATS_PAGE_SIZE = 30
KANBAN_PAGE_SIZE = 40
MESSAGES_PAGE_SIZE = 50
CUSTOMER_SERVICE_WINDOW = timedelta(hours=24)


class LeadAlreadyExistsError(Exception):
    pass


class EmailAlreadyExistsError(Exception):
    pass


class TagAlreadyExistsError(Exception):
    pass


class LastAdminError(Exception):
    """Se levanta al intentar desactivar/degradar al único admin activo."""

    pass


def _fmt_ts(value: datetime | None) -> str | None:
    # Microsegundos incluidos: la paginación por cursor usa este mismo valor
    # de ida y vuelta, y truncarlo a segundos podía generar colisiones falsas.
    return value.strftime('%Y-%m-%dT%H:%M:%S.%fZ') if value else None


def _phone_to_jid(phone: str) -> str:
    digits = re.sub(r"\D", "", phone)
    return f"{digits}@s.whatsapp.net"


def _row_to_chat(row, tags: list[dict] | None = None) -> dict:
    stage = row["stage"]
    return {
        "chat_id": row["chat_id"],
        "phone": row["phone"],
        "name": row["name"],
        "servicio_interes": row["servicio_interes"],
        "vendedor_id": row["vendedor_id"],
        "vendedor": row["vendedor"],
        "origen": row["origen"],
        "notas": row["notas"],
        "stage": stage.value if isinstance(stage, LeadStage) else stage,
        "con_especialista": row["con_especialista"],
        "last_message": row["last_message"],
        "last_message_sender": row["last_message_sender"],
        "timestamp": _fmt_ts(row["timestamp"]),
        "last_customer_message_at": _fmt_ts(row["last_customer_message_at"]),
        "unread_count": row["unread_count"],
        "tags": tags or [],
        # Presentes solo cuando la consulta llevaba búsqueda activa.
        "search_rank": row["search_rank"] if "search_rank" in row else 2,
        "matched_message": row["matched_message"] if "matched_message" in row else None,
        "matched_message_id": row["matched_message_id"] if "matched_message_id" in row else None,
    }


def _tag_dict(row) -> dict:
    return {"id": row["id"], "name": row["name"], "color": row["color"]}


async def _tags_by_lead(session, chat_ids: list[str]) -> dict[str, list[dict]]:
    if not chat_ids:
        return {}
    stmt = (
        select(
            LeadTagAssignment.lead_id,
            LeadTag.id,
            LeadTag.name,
            LeadTag.color,
        )
        .join(LeadTag, LeadTag.id == LeadTagAssignment.tag_id)
        .where(LeadTagAssignment.lead_id.in_(chat_ids), LeadTag.is_active == true())
        .order_by(LeadTag.name.asc())
    )
    rows = (await session.execute(stmt)).mappings().all()
    result: dict[str, list[dict]] = {chat_id: [] for chat_id in chat_ids}
    for row in rows:
        result[row["lead_id"]].append(_tag_dict(row))
    return result


def _parse_ts(value: str) -> datetime:
    return datetime.strptime(value, '%Y-%m-%dT%H:%M:%S.%fZ').replace(tzinfo=timezone.utc)


def _last_message_subquery():
    """Último mensaje por chat vía LATERAL JOIN, evita un N+1 por lead.
    Incluye sender: el frontend lo usa para saber si el chat quedó
    "esperando respuesta" (último mensaje del cliente) o no (vendedor)."""
    return (
        select(WspMessage.content, WspMessage.sent_at, WspMessage.sender)
        .where(WspMessage.chat_id == Lead.remote_jid)
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
            WspMessage.chat_id == Lead.remote_jid,
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
            WspMessage.chat_id == Lead.remote_jid,
            WspMessage.sender == "cliente",
            or_(Lead.last_read_at.is_(None), WspMessage.sent_at > Lead.last_read_at),
        )
        .correlate(Lead)
    )


def _last_customer_message_at_subquery():
    return (
        select(func.max(WspMessage.sent_at))
        .where(WspMessage.chat_id == Lead.remote_jid, WspMessage.sender == "cliente")
        .correlate(Lead)
        .scalar_subquery()
    )


def _has_tag_condition(tag_id: int):
    return exists(
        select(LeadTagAssignment.tag_id)
        .join(LeadTag, LeadTag.id == LeadTagAssignment.tag_id)
        .where(
            LeadTagAssignment.lead_id == Lead.remote_jid,
            LeadTagAssignment.tag_id == tag_id,
            LeadTag.is_active == true(),
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
        Lead.remote_jid.ilike(pattern, escape="\\"),
        Lead.telefono.ilike(pattern, escape="\\"),
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
            func.regexp_replace(Lead.remote_jid, r"\D", "", "g").like(digits_pattern)
        )
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


def _message_match_condition(search: str):
    """Historial completo del chat, no solo el último mensaje: en WhatsApp
    un chat aparece aunque el término esté en un mensaje viejo."""
    pattern = f"%{_escape_like(search)}%"
    return exists(
        select(WspMessage.id)
        .where(
            WspMessage.chat_id == Lead.remote_jid,
            _unaccent_ilike(WspMessage.content, pattern),
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
    pattern = f"%{_escape_like(search)}%"
    return (
        select(column if column is not None else WspMessage.content)
        .where(
            WspMessage.chat_id == Lead.remote_jid,
            _unaccent_ilike(WspMessage.content, pattern),
        )
        .order_by(WspMessage.sent_at.desc())
        .limit(1)
        .correlate(Lead)
        .scalar_subquery()
    )


def _chat_columns(last_message):
    seller_name = select(User.name).where(User.id == Lead.vendedor_id).scalar_subquery()
    return (
        Lead.remote_jid.label("chat_id"),
        Lead.telefono.label("phone"),
        Lead.nombre.label("name"),
        Lead.servicio_interes,
        Lead.vendedor_id,
        func.coalesce(seller_name, Lead.vendedor).label("vendedor"),
        Lead.origen,
        Lead.notas,
        Lead.estado.label("stage"),
        Lead.con_especialista,
        last_message.c.content.label("last_message"),
        last_message.c.sender.label("last_message_sender"),
        last_message.c.sent_at.label("timestamp"),
        _last_customer_message_at_subquery().label("last_customer_message_at"),
        _unread_count_subquery().label("unread_count"),
    )


def _cursor_condition(last_message, cursor_ts: str | None, cursor_id: str):
    """Condición de paginación por keyset sobre el mismo orden de la consulta
    (last_message.sent_at DESC NULLS LAST, remote_jid DESC).

    cursor_ts/cursor_id identifican la última fila de la página anterior;
    se piden las filas que la siguen en ese orden. A diferencia de OFFSET,
    esto no se desalinea si un chat sube al tope por un mensaje nuevo entre
    una página y la siguiente.
    """
    if cursor_ts is not None:
        parsed_ts = _parse_ts(cursor_ts)
        return or_(
            last_message.c.sent_at < parsed_ts,
            and_(last_message.c.sent_at == parsed_ts, Lead.remote_jid < cursor_id),
            last_message.c.sent_at.is_(None),
        )
    # La fila cursor ya estaba en la cola de timestamp nulo: solo quedan
    # otras filas sin mensajes, desempatadas por remote_jid.
    return and_(last_message.c.sent_at.is_(None), Lead.remote_jid < cursor_id)


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
    )

    if search:
        stmt = stmt.where(_chat_search_condition(search))

    if unread_only:
        stmt = stmt.where(_has_unread_messages_condition())

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
    order_keys = [last_message.c.sent_at.desc().nulls_last(), Lead.remote_jid.desc()]
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
        .where(Lead.remote_jid == chat_id)
    )
    async with get_sessionmaker()() as session:
        row = (await session.execute(stmt)).mappings().first()
        tags_by_lead = await _tags_by_lead(session, [chat_id]) if row is not None else {}

    return _row_to_chat(row, tags_by_lead.get(chat_id)) if row is not None else None


async def get_customer_service_window(chat_id: str) -> dict | None:
    last_customer_message = (
        select(func.max(WspMessage.sent_at))
        .where(
            WspMessage.chat_id == Lead.remote_jid,
            WspMessage.sender == "cliente",
        )
        .correlate(Lead)
        .scalar_subquery()
    )
    async with get_sessionmaker()() as session:
        row = (await session.execute(
            select(Lead.remote_jid, last_customer_message.label("last_customer_message_at"))
            .where(Lead.remote_jid == chat_id)
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
    stmt = select(exists().where(Lead.remote_jid == chat_id))
    async with get_sessionmaker()() as session:
        return bool(await session.scalar(stmt))


async def fetch_kanban_counts(search: str | None = None) -> dict[str, int]:
    """Conteos del embudo. Con búsqueda se aplica el mismo filtro que a las
    tarjetas, incluido el último mensaje, para que los encabezados coincidan."""
    last_message = _last_message_subquery()
    stmt = (
        select(Lead.estado, func.count(Lead.remote_jid))
        .join(last_message, true(), isouter=True)
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
        Lead.remote_jid.desc(),
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
        Lead.remote_jid.desc(),
    ]
    if search:
        columns.append(_search_rank_expression(search).label("search_rank"))
        columns.append(_matched_message_subquery(search).label("matched_message"))
        columns.append(_matched_message_subquery(search, WspMessage.id).label("matched_message_id"))
        order_keys.insert(0, _search_rank_expression(search).desc())
    stmt = (
        select(*columns)
        .join(last_message, true(), isouter=True)
        .where(Lead.estado == stage)
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


async def _record_activity(
    session,
    lead_id: str,
    event_type: str,
    actor_type: str,
    actor_user_id: int | None = None,
    old_value: dict | None = None,
    new_value: dict | None = None,
    metadata: dict | None = None,
) -> None:
    await session.execute(
        insert(LeadActivity).values(
            lead_id=lead_id,
            event_type=event_type,
            actor_type=actor_type,
            actor_user_id=actor_user_id,
            old_value=old_value,
            new_value=new_value,
            metadata_=metadata,
            created_at=datetime.now(timezone.utc),
        )
    )


async def update_lead_stage(
    chat_id: str,
    stage: LeadStage,
    actor_type: str = "system",
    actor_user_id: int | None = None,
    metadata: dict | None = None,
    include_chat: bool = True,
) -> dict | None:
    async with get_sessionmaker()() as session:
        old_stage = (
            await session.execute(select(Lead.estado).where(Lead.remote_jid == chat_id).with_for_update())
        ).scalar_one_or_none()
        if old_stage is None:
            return None
        changed = old_stage != stage
        if changed:
            await session.execute(
                update(Lead)
                .where(Lead.remote_jid == chat_id)
                .values(estado=stage, updated_at=datetime.now(timezone.utc))
            )
            # Se congela el último mensaje del cliente en la auditoría: el
            # chat sigue creciendo después del cambio, así que sin esta foto
            # no habría forma de saber qué dijo la persona para ser movida.
            trigger = (
                await session.execute(
                    select(WspMessage.id, WspMessage.content, WspMessage.sent_at)
                    .where(WspMessage.chat_id == chat_id, WspMessage.sender == "cliente")
                    .order_by(WspMessage.sent_at.desc(), WspMessage.id.desc())
                    .limit(1)
                )
            ).mappings().first()
            if trigger is not None:
                content = (trigger["content"] or "").strip()
                if len(content) > 300:
                    content = content[:300] + "…"
                metadata = {
                    **(metadata or {}),
                    "trigger_message": {
                        "id": trigger["id"],
                        "content": content,
                        "sent_at": _fmt_ts(trigger["sent_at"]),
                    },
                }
            await _record_activity(
                session,
                chat_id,
                AutomationTrigger.STAGE_CHANGED,
                actor_type,
                actor_user_id,
                {"stage": old_stage.value if isinstance(old_stage, LeadStage) else old_stage},
                {"stage": stage.value},
                metadata,
            )
        await session.commit()

    if not include_chat:
        return {"chat_id": chat_id, "stage": stage.value, "changed": changed}
    return await fetch_chat(chat_id)


async def get_cached_suggestion(chat_id: str) -> dict | None:
    """Devuelve la última sugerencia de n8n guardada para este lead, siempre
    que siga vigente: tiene que existir Y no haber llegado ningún mensaje del
    cliente después de que se generó (un mensaje del propio vendedor no la
    invalida — la sugerencia sigue siendo válida para lo que dijo el cliente)."""
    has_newer_message = exists(
        select(WspMessage.id).where(
            WspMessage.chat_id == Lead.remote_jid,
            WspMessage.sender == "cliente",
            WspMessage.sent_at > Lead.cached_suggestion_at,
        )
    )
    stmt = select(
        Lead.cached_suggestion,
        Lead.cached_suggestion_at,
        has_newer_message.label("has_newer_message"),
    ).where(Lead.remote_jid == chat_id)
    async with get_sessionmaker()() as session:
        row = (await session.execute(stmt)).mappings().one_or_none()

    if (
        row is None
        or row["cached_suggestion"] is None
        or row["cached_suggestion_at"] is None
        or row["has_newer_message"]
    ):
        return None
    return row["cached_suggestion"]


async def cache_suggestion(chat_id: str, suggestion: dict) -> bool:
    stmt = (
        update(Lead)
        .where(Lead.remote_jid == chat_id)
        .values(cached_suggestion=suggestion, cached_suggestion_at=datetime.now(timezone.utc))
    )
    async with get_sessionmaker()() as session:
        result = await session.execute(stmt)
        await session.commit()
    return result.rowcount > 0


async def create_lead(
    phone: str,
    name: str,
    servicio_interes: str | None = None,
    vendedor_id: int | None = None,
    origen: str | None = None,
    notas: str | None = None,
    actor_user_id: int | None = None,
) -> dict:
    chat_id = _phone_to_jid(phone)
    seller_name = None
    if vendedor_id is not None:
        async with get_sessionmaker()() as lookup_session:
            seller = await lookup_session.get(User, vendedor_id)
            if seller is None or not seller.is_active:
                raise ValueError("Vendedor no encontrado o inactivo")
            seller_name = seller.name
    stmt = insert(Lead).values(
        remote_jid=chat_id,
        telefono=phone,
        nombre=name,
        servicio_interes=servicio_interes,
        vendedor_id=vendedor_id,
        vendedor=seller_name,
        origen=origen,
        notas=notas,
    )
    async with get_sessionmaker()() as session:
        try:
            await session.execute(stmt)
            await _record_activity(
                session,
                chat_id,
                AutomationTrigger.LEAD_CREATED,
                "user" if actor_user_id is not None else "system",
                actor_user_id,
                new_value={"name": name, "phone": phone},
            )
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raise LeadAlreadyExistsError(chat_id)

    return await fetch_chat(chat_id)


async def update_lead(
    chat_id: str,
    values: dict,
    actor_type: str = "system",
    actor_user_id: int | None = None,
) -> dict | None:
    if not values:
        return await fetch_chat(chat_id)

    async with get_sessionmaker()() as session:
        if "vendedor_id" in values:
            seller_id = values["vendedor_id"]
            if seller_id is None:
                values["vendedor"] = None
            else:
                seller = await session.get(User, seller_id)
                if seller is None or not seller.is_active:
                    raise ValueError("Vendedor no encontrado o inactivo")
                # Espejo de compatibilidad; vendedor_id sigue siendo la fuente real.
                values["vendedor"] = seller.name
        columns = [getattr(Lead, key) for key in values]
        old_row = (
            await session.execute(select(*columns).where(Lead.remote_jid == chat_id).with_for_update())
        ).mappings().first()
        if old_row is None:
            return None
        changed = {key: value for key, value in values.items() if old_row[key] != value}
        if changed:
            await session.execute(
                update(Lead)
                .where(Lead.remote_jid == chat_id)
                .values(**changed, updated_at=datetime.now(timezone.utc))
            )
            await _record_activity(
                session,
                chat_id,
                "lead_updated",
                actor_type,
                actor_user_id,
                {key: old_row[key] for key in changed},
                changed,
            )
        await session.commit()

    return await fetch_chat(chat_id)


async def insert_message(
    chat_id: str,
    sender: str,
    content: str,
    media_url: str | None = None,
    wa_message_id: str | None = None,
    status: str | None = None,
) -> dict:
    stmt = (
        insert(WspMessage)
        .values(
            chat_id=chat_id,
            sender=sender,
            content=content,
            media_url=media_url,
            sent_at=datetime.now(timezone.utc),
            wa_message_id=wa_message_id,
            status=status,
        )
        .returning(
            WspMessage.id,
            WspMessage.sender,
            WspMessage.content,
            WspMessage.sent_at,
            WspMessage.media_url,
            WspMessage.wa_message_id,
            WspMessage.status,
        )
    )
    async with get_sessionmaker()() as session:
        row = (await session.execute(stmt)).mappings().one()
        await session.commit()

    return {
        "id": row["id"],
        "sender": row["sender"],
        "content": row["content"],
        "sent_at": _fmt_ts(row["sent_at"]),
        "media_url": row["media_url"],
        "wa_message_id": row["wa_message_id"],
        "status": row["status"],
    }


async def update_message_status(wa_message_id: str, status: str) -> dict | None:
    """Avanza el estado de un mensaje sin permitir regresiones.

    Los webhooks pueden llegar repetidos o fuera de orden. El ``WHERE`` hace
    atómica la comparación para que READ/PLAYED nunca vuelva a DELIVERY_ACK.
    Devuelve None si el ID no existe o el evento no aporta un estado nuevo.
    """
    status_rank = {
        "SERVER_ACK": 1,
        "DELIVERY_ACK": 2,
        "READ": 3,
        "PLAYED": 4,
    }
    incoming_rank = status_rank.get(status)
    if incoming_rank is None:
        return None

    current_rank = case(
        (WspMessage.status == "SERVER_ACK", 1),
        (WspMessage.status == "DELIVERY_ACK", 2),
        (WspMessage.status == "READ", 3),
        (WspMessage.status == "PLAYED", 4),
        else_=0,
    )
    stmt = (
        update(WspMessage)
        .where(
            WspMessage.wa_message_id == wa_message_id,
            current_rank < incoming_rank,
        )
        .values(status=status)
        .returning(WspMessage.id, WspMessage.chat_id)
    )
    async with get_sessionmaker()() as session:
        row = (await session.execute(stmt)).mappings().first()
        if row is None:
            return None
        await session.commit()

    return {"id": row["id"], "chat_id": row["chat_id"]}


async def mark_chat_read(chat_id: str) -> None:
    stmt = update(Lead).where(Lead.remote_jid == chat_id).values(last_read_at=datetime.now(timezone.utc))
    async with get_sessionmaker()() as session:
        await session.execute(stmt)
        await session.commit()


async def mark_chat_read_from_whatsapp_receipt(wa_message_id: str) -> dict | None:
    """Avanza la lectura interna hasta un mensaje del cliente leído en WhatsApp.

    Se usa el ``sent_at`` del mensaje como marca de agua, no la hora actual:
    así un recibo tardío nunca marca como vistos mensajes que llegaron después.
    Solo acepta filas de ``sender=cliente`` para no confundir el READ de un
    mensaje saliente (el lead lo leyó) con una lectura hecha por el vendedor.
    """
    message_stmt = (
        select(WspMessage.chat_id, WspMessage.sent_at)
        .where(
            WspMessage.wa_message_id == wa_message_id,
            WspMessage.sender == "cliente",
        )
        .order_by(WspMessage.sent_at.desc(), WspMessage.id.desc())
        .limit(1)
    )
    async with get_sessionmaker()() as session:
        message = (await session.execute(message_stmt)).mappings().first()
        if message is None:
            return None

        update_stmt = (
            update(Lead)
            .where(
                Lead.remote_jid == message["chat_id"],
                or_(
                    Lead.last_read_at.is_(None),
                    Lead.last_read_at < message["sent_at"],
                ),
            )
            .values(last_read_at=message["sent_at"])
            .returning(Lead.remote_jid)
        )
        chat_id = (await session.execute(update_stmt)).scalar_one_or_none()
        if chat_id is None:
            return None
        await session.commit()

    return {
        "chat_id": chat_id,
        "last_read_at": _fmt_ts(message["sent_at"]),
    }


async def fetch_unread_wa_message_ids(chat_id: str) -> list[str]:
    """IDs de WhatsApp de los mensajes del cliente sin ver en este chat —
    para avisarle a Evolution API que se leyeron (markMessageAsRead). Hay
    que llamar esto ANTES de mark_chat_read: una vez actualizado
    last_read_at, estos mensajes dejan de contar como "sin ver"."""
    stmt = (
        select(WspMessage.wa_message_id)
        .join(Lead, Lead.remote_jid == WspMessage.chat_id)
        .where(
            WspMessage.chat_id == chat_id,
            WspMessage.sender == "cliente",
            WspMessage.wa_message_id.is_not(None),
            WspMessage.wa_message_id != "",
            or_(Lead.last_read_at.is_(None), WspMessage.sent_at > Lead.last_read_at),
        )
    )
    async with get_sessionmaker()() as session:
        return list((await session.execute(stmt)).scalars().all())


async def fetch_total_unread_chat_count() -> int:
    """Total de chats con al menos un mensaje de cliente aún no visto."""
    stmt = (
        select(func.count(func.distinct(WspMessage.chat_id)))
        .join(Lead, Lead.remote_jid == WspMessage.chat_id)
        .where(
            WspMessage.sender == "cliente",
            or_(Lead.last_read_at.is_(None), WspMessage.sent_at > Lead.last_read_at),
        )
    )
    async with get_sessionmaker()() as session:
        return (await session.execute(stmt)).scalar_one()


async def fetch_chat_signature() -> str:
    """Firma liviana del estado de los mensajes, usada para detectar mensajes nuevos como respaldo del webhook."""
    stmt = select(func.count(WspMessage.id), func.max(WspMessage.sent_at))
    async with get_sessionmaker()() as session:
        count, last_sent = (await session.execute(stmt)).one()
    return f"{count}:{last_sent.isoformat() if last_sent else ''}"


async def fetch_latest_message() -> dict | None:
    """Último mensaje de cualquier chat, con el nombre del lead — se usa para
    armar la notificación cuando el webhook de n8n avisa de un mensaje nuevo."""
    stmt = (
        select(
            WspMessage.id,
            WspMessage.wa_message_id,
            WspMessage.chat_id,
            WspMessage.sender,
            WspMessage.content,
            Lead.nombre,
        )
        .outerjoin(Lead, Lead.remote_jid == WspMessage.chat_id)
        .order_by(WspMessage.sent_at.desc(), WspMessage.id.desc())
        .limit(1)
    )
    async with get_sessionmaker()() as session:
        row = (await session.execute(stmt)).mappings().first()

    if row is None:
        return None
    return {
        # Se serializa como texto para que IDs bigint no pierdan precisión en JS.
        "message_id": row["wa_message_id"] or str(row["id"]),
        "chat_id": row["chat_id"],
        "sender": row["sender"],
        "content": row["content"],
        "name": row["nombre"],
    }


# Techo del salto a un mensaje de búsqueda: evita cargar una conversación
# gigante entera si el match está muy atrás en el historial.
JUMP_TO_MESSAGE_MAX = 1000


async def fetch_messages(
    chat_id: str,
    cursor_ts: datetime | None = None,
    cursor_id: int | None = None,
    limit: int = MESSAGES_PAGE_SIZE,
    until_id: int | None = None,
) -> dict:
    """Devuelve una página hacia atrás del historial.

    La consulta recorre (sent_at, id) en orden descendente para empezar por
    los mensajes más recientes. La respuesta se invierte a ascendente para
    que cada página se pueda renderizar en el orden natural de conversación.
    `id` desempata mensajes con el mismo timestamp y evita saltos/duplicados.

    Con `until_id` (abrir un chat desde un resultado de búsqueda por mensaje)
    la primera página se agranda hasta incluir ese mensaje, más una página de
    contexto anterior, para poder hacer scroll hasta él y resaltarlo.
    """
    if (cursor_ts is None) != (cursor_id is None):
        raise ValueError("cursor_ts y cursor_id deben enviarse juntos")

    async with get_sessionmaker()() as session:
        if until_id is not None and cursor_id is None:
            target_ts = await session.scalar(
                select(WspMessage.sent_at).where(
                    WspMessage.id == until_id, WspMessage.chat_id == chat_id
                )
            )
            if target_ts is not None:
                span_count = await session.scalar(
                    select(func.count()).where(
                        WspMessage.chat_id == chat_id,
                        or_(
                            WspMessage.sent_at > target_ts,
                            and_(WspMessage.sent_at == target_ts, WspMessage.id >= until_id),
                        ),
                    )
                )
                limit = min(span_count + limit, JUMP_TO_MESSAGE_MAX)

        stmt = (
            select(
                WspMessage.id,
                WspMessage.sender,
                WspMessage.content,
                WspMessage.sent_at,
                WspMessage.media_url,
                WspMessage.wa_message_id,
                WspMessage.status,
                WspMessage.media_width,
                WspMessage.media_height,
            )
            .where(WspMessage.chat_id == chat_id)
            .order_by(WspMessage.sent_at.desc(), WspMessage.id.desc())
            .limit(limit + 1)
        )

        if cursor_ts is not None and cursor_id is not None:
            stmt = stmt.where(
                or_(
                    WspMessage.sent_at < cursor_ts,
                    and_(WspMessage.sent_at == cursor_ts, WspMessage.id < cursor_id),
                )
            )

        rows = (await session.execute(stmt)).mappings().all()

        has_more = len(rows) > limit
        page = [dict(r) for r in reversed(rows[:limit])]
        await _fill_media_dimensions(session, page)

    items = [
        {
            "id": r["id"],
            "sender": r["sender"],
            "content": r["content"],
            "sent_at": _fmt_ts(r["sent_at"]),
            "media_url": r["media_url"],
            "wa_message_id": r["wa_message_id"],
            "status": r["status"],
            # 0/0 (= no medible) no le sirve al frontend: se expone como None.
            "media_width": r["media_width"] or None,
            "media_height": r["media_height"] or None,
        }
        for r in page
    ]
    return {"items": items, "has_more": has_more}


async def _fill_media_dimensions(session, rows: list[dict]) -> None:
    """Completa y persiste media_width/height de imágenes y videos que aún no
    lo tienen, para que el frontend reserve el espacio exacto antes de que
    carguen. Corre una sola vez por mensaje (backfill perezoso); 0/0 marca
    los que no se pudieron medir para no reintentarlos en cada apertura."""
    from services.media_storage import image_dimensions, video_dimensions

    pending = [
        r for r in rows
        if r["media_url"] and r["media_width"] is None
        and (r["content"] or "").startswith(("<image", "<video"))
    ]
    for r in pending:
        measure = image_dimensions if r["content"].startswith("<image") else video_dimensions
        dims = await asyncio.to_thread(measure, r["media_url"])
        r["media_width"], r["media_height"] = dims if dims else (0, 0)
        await session.execute(
            update(WspMessage)
            .where(WspMessage.id == r["id"])
            .values(media_width=r["media_width"], media_height=r["media_height"])
        )
    if pending:
        await session.commit()


async def list_tags(include_inactive: bool = False) -> list[dict]:
    stmt = select(LeadTag.id, LeadTag.name, LeadTag.color, LeadTag.is_active).order_by(LeadTag.name.asc())
    if not include_inactive:
        stmt = stmt.where(LeadTag.is_active == true())
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [dict(row) for row in rows]


async def create_tag(name: str, color: str, user_id: int) -> dict:
    stmt = (
        insert(LeadTag)
        .values(
            name=name,
            color=color,
            is_active=True,
            created_by=user_id,
            created_at=datetime.now(timezone.utc),
        )
        .returning(LeadTag.id, LeadTag.name, LeadTag.color, LeadTag.is_active)
    )
    async with get_sessionmaker()() as session:
        try:
            row = (await session.execute(stmt)).mappings().one()
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raise TagAlreadyExistsError(name)
    return dict(row)


async def update_tag(tag_id: int, values: dict) -> dict | None:
    if not values:
        stmt = select(LeadTag.id, LeadTag.name, LeadTag.color, LeadTag.is_active).where(LeadTag.id == tag_id)
        async with get_sessionmaker()() as session:
            row = (await session.execute(stmt)).mappings().first()
        return dict(row) if row else None
    stmt = (
        update(LeadTag)
        .where(LeadTag.id == tag_id)
        .values(**values)
        .returning(LeadTag.id, LeadTag.name, LeadTag.color, LeadTag.is_active)
    )
    async with get_sessionmaker()() as session:
        try:
            row = (await session.execute(stmt)).mappings().first()
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raise TagAlreadyExistsError(values.get("name", ""))
    return dict(row) if row else None


async def assign_tag(chat_id: str, tag_id: int, user_id: int) -> bool:
    async with get_sessionmaker()() as session:
        lead_exists = (await session.execute(select(Lead.remote_jid).where(Lead.remote_jid == chat_id))).first()
        tag = (
            await session.execute(
                select(LeadTag.id, LeadTag.name, LeadTag.color).where(
                    LeadTag.id == tag_id, LeadTag.is_active == true()
                )
            )
        ).mappings().first()
        if lead_exists is None or tag is None:
            return False
        existing = (
            await session.execute(
                select(LeadTagAssignment.tag_id).where(
                    LeadTagAssignment.lead_id == chat_id,
                    LeadTagAssignment.tag_id == tag_id,
                )
            )
        ).first()
        if existing is None:
            await session.execute(
                insert(LeadTagAssignment).values(
                    lead_id=chat_id,
                    tag_id=tag_id,
                    assigned_by=user_id,
                    assigned_at=datetime.now(timezone.utc),
                )
            )
            await _record_activity(
                session,
                chat_id,
                "tag_added",
                "user",
                user_id,
                new_value={"tag": _tag_dict(tag)},
            )
            await session.commit()
        return True


async def remove_tag(chat_id: str, tag_id: int, user_id: int) -> bool:
    async with get_sessionmaker()() as session:
        tag = (
            await session.execute(
                select(LeadTag.id, LeadTag.name, LeadTag.color)
                .join(LeadTagAssignment, LeadTagAssignment.tag_id == LeadTag.id)
                .where(LeadTagAssignment.lead_id == chat_id, LeadTag.id == tag_id)
            )
        ).mappings().first()
        if tag is None:
            return False
        await session.execute(
            delete(LeadTagAssignment).where(
                LeadTagAssignment.lead_id == chat_id,
                LeadTagAssignment.tag_id == tag_id,
            )
        )
        await _record_activity(
            session,
            chat_id,
            "tag_removed",
            "user",
            user_id,
            old_value={"tag": _tag_dict(tag)},
        )
        await session.commit()
        return True


async def list_lead_activity(chat_id: str, limit: int = 50) -> list[dict]:
    stmt = (
        select(
            LeadActivity.id,
            LeadActivity.event_type,
            LeadActivity.actor_type,
            User.name.label("actor_name"),
            LeadActivity.old_value,
            LeadActivity.new_value,
            LeadActivity.metadata_,
            LeadActivity.created_at,
        )
        .outerjoin(User, User.id == LeadActivity.actor_user_id)
        .where(LeadActivity.lead_id == chat_id)
        .order_by(LeadActivity.created_at.desc(), LeadActivity.id.desc())
        .limit(limit)
    )
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [
        {
            "id": row["id"],
            "event_type": row["event_type"],
            "actor_type": row["actor_type"],
            "actor_name": row["actor_name"],
            "old_value": row["old_value"],
            "new_value": row["new_value"],
            "metadata": row["metadata_"],
            "created_at": _fmt_ts(row["created_at"]),
        }
        for row in rows
    ]


def _row_to_user(user: User) -> dict:
    return {
        "id": user.id,
        "email": user.email,
        "name": user.name,
        "role": user.role,
        "is_active": user.is_active,
    }


async def get_user_by_id(user_id: int) -> User | None:
    async with get_sessionmaker()() as session:
        return await session.get(User, user_id)


async def get_user_by_email(email: str) -> User | None:
    stmt = select(User).where(User.email == email)
    async with get_sessionmaker()() as session:
        return (await session.execute(stmt)).scalar_one_or_none()


async def list_users() -> list[dict]:
    stmt = select(User).order_by(User.created_at.asc())
    async with get_sessionmaker()() as session:
        users = (await session.execute(stmt)).scalars().all()
    return [_row_to_user(u) for u in users]


async def list_active_sellers() -> list[dict]:
    stmt = select(User.id, User.name, User.role).where(User.is_active == true()).order_by(User.name.asc())
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [dict(row) for row in rows]


async def create_user(email: str, name: str, password_hash: str, role: str) -> dict:
    stmt = insert(User).values(
        email=email,
        name=name,
        password_hash=password_hash,
        role=role,
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    async with get_sessionmaker()() as session:
        try:
            await session.execute(stmt)
            await session.commit()
        except IntegrityError:
            await session.rollback()
            raise EmailAlreadyExistsError(email)

    user = await get_user_by_email(email)
    return _row_to_user(user)


async def count_active_admins(exclude_user_id: int | None = None) -> int:
    stmt = select(func.count(User.id)).where(User.role == "admin", User.is_active == true())
    if exclude_user_id is not None:
        stmt = stmt.where(User.id != exclude_user_id)
    async with get_sessionmaker()() as session:
        return (await session.execute(stmt)).scalar_one()


async def update_user(user_id: int, values: dict) -> dict | None:
    """values puede traer 'role' y/o 'is_active'. Si el cambio dejaría sin
    ningún admin activo, se rechaza con LastAdminError antes de aplicarlo."""
    demotes_or_deactivates = values.get("role") == "vendedor" or values.get("is_active") is False
    if demotes_or_deactivates:
        user = await get_user_by_id(user_id)
        if user is not None and user.role == "admin" and await count_active_admins(exclude_user_id=user_id) == 0:
            raise LastAdminError()

    if not values:
        user = await get_user_by_id(user_id)
        return _row_to_user(user) if user else None

    stmt = update(User).where(User.id == user_id).values(**values)
    async with get_sessionmaker()() as session:
        result = await session.execute(stmt)
        if result.rowcount == 0:
            return None
        await session.commit()

    user = await get_user_by_id(user_id)
    return _row_to_user(user) if user else None


async def set_user_password(user_id: int, password_hash: str) -> bool:
    stmt = update(User).where(User.id == user_id).values(password_hash=password_hash)
    async with get_sessionmaker()() as session:
        result = await session.execute(stmt)
        await session.commit()
        return result.rowcount > 0


async def seed_admin_if_needed(email: str, password_hash: str) -> None:
    """Crea el primer admin si la tabla users está vacía. No hace nada si ya
    existe algún usuario (aunque ADMIN_EMAIL/ADMIN_PASSWORD sigan en el .env)."""
    async with get_sessionmaker()() as session:
        count = (await session.execute(select(func.count(User.id)))).scalar_one()
    if count > 0:
        return

    await create_user(email=email, name="Admin", password_hash=password_hash, role="admin")
