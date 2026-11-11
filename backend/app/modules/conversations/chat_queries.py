import re
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from sqlalchemy import and_, case, exists, false, func, or_, select, true

from app.db.models.leads import Lead, LeadTagAssignment, WhatsAppIdentity
from app.db.models.catalogs import LeadTag
from app.db.models.auth import User
from app.db.models.conversations import WhatsAppEntryPointWindow, WspMessage
from app.db.uow import session_scope
from app.integrations.whatsapp.connection import connection_scope
from app.modules.conversations.chat_rows import CHATS_PAGE_SIZE, _row_to_chat, _tags_by_lead
from app.modules.conversations.domain.service_window import AD_REPLY_WINDOW, CUSTOMER_SERVICE_WINDOW
from app.core.time_format import iso_utc_micros as _fmt_ts, parse_iso_utc_micros as _parse_ts


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
            WspMessage.message_subtype,
            WspMessage.deleted_at,
        )
        .where(WspMessage.chat_id == Lead.id)
        # Mismo criterio que el hilo: una reacción es un badge, no el
        # último mensaje de la conversación.
        .where(WspMessage.message_type.is_distinct_from("reaction"))
        .order_by(WspMessage.sent_at.desc(), WspMessage.id.desc())
        .limit(1)
        # Explícito: la búsqueda por mensaje ya trae `wsp_messages` en su
        # FROM, y con la correlación automática esta subconsulta se quedaba
        # sin tabla propia.
        .correlate(Lead)
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
    """Un lead solo se lista si tiene un identificador visto en el número de
    WhatsApp activo (o el `"*"` de los leads creados a mano).

    Si no hay ningún número configurado no se filtra nada: no hay forma de
    saber cuál es "el activo".
    """
    scope = await connection_scope()
    if scope is None:
        return true()
    return exists(
        select(WhatsAppIdentity.id)
        .where(
            WhatsAppIdentity.lead_id == Lead.id,
            WhatsAppIdentity.phone_number_id.in_(scope),
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


# Tope de palabras por búsqueda: cada una suma condiciones a la consulta.
MAX_SEARCH_TERMS = 8


def search_terms(search: str) -> list[str]:
    """Las palabras de la búsqueda, sin repetir.

    Se busca por palabras y no por la frase exacta: con la frase, "limpieza
    facial" no encontraba "limpiezas faciales" ni "limpieza profunda facial",
    y WhatsApp sí (queja de las vendedoras, 2026-11-11).
    """
    terms: list[str] = []
    seen: set[str] = set()
    for term in search.split():
        key = term.casefold()
        if key not in seen:
            seen.add(key)
            terms.append(term)
    return terms[:MAX_SEARCH_TERMS]


def _patterns(search: str) -> list[str]:
    return [f"%{_escape_like(term)}%" for term in search_terms(search)]


def _identity_fields(pattern: str) -> list:
    """Nombre, teléfono o identificador de WhatsApp del lead: lo que busca el
    usuario la mayoría de las veces, y lo que WhatsApp muestra primero."""
    return [
        exists(select(WhatsAppIdentity.id).where(
            WhatsAppIdentity.lead_id == Lead.id,
            WhatsAppIdentity.identifier.ilike(pattern, escape="\\"),
        )),
        Lead.telefono.ilike(pattern, escape="\\"),
        Lead.telefono_secundario.ilike(pattern, escape="\\"),
        _unaccent_ilike(Lead.nombre_usuario, pattern),
        _unaccent_ilike(Lead.nombre, pattern),
    ]


def _crm_fields(pattern: str) -> list:
    """Campos CRM (vendedor/servicio/origen). Siguen siendo buscables, pero
    rankean debajo de los matches por nombre: si no, buscar el nombre de un
    vendedor entierra al lead que se llama igual bajo todos sus asignados."""
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


def _phone_digit_conditions(search: str) -> list:
    """Teléfonos: comparar solo dígitos contra solo dígitos, para que
    "1112345678" encuentre "+54 9 11 1234-5678" sin importar el formato. Va
    sobre la búsqueda entera y no por palabra: un número escrito con espacios
    es un solo teléfono."""
    digits = re.sub(r"\D", "", search)
    if len(digits) < 5:
        return []
    digits_pattern = f"%{digits}%"
    return [
        func.regexp_replace(Lead.telefono, r"\D", "", "g").like(digits_pattern),
        func.regexp_replace(Lead.telefono_secundario, r"\D", "", "g").like(digits_pattern),
        exists(select(WhatsAppIdentity.id).where(
            WhatsAppIdentity.lead_id == Lead.id,
            WhatsAppIdentity.kind == "wa_id",
            WhatsAppIdentity.identifier.like(digits_pattern),
        )),
    ]


def _every_term(search: str, fields) -> list:
    """Cada palabra tiene que aparecer en alguno de los campos."""
    patterns = _patterns(search)
    if not patterns:
        return []
    return [and_(*[or_(*fields(pattern)) for pattern in patterns])]


def _identity_match(search: str):
    return or_(false(), *_every_term(search, _identity_fields), *_phone_digit_conditions(search))


def _contact_search_condition(search: str):
    """El lead matchea por sus propios datos (identidad o campos CRM), sin
    mirar sus mensajes: la sección "Contactos" del buscador. Las palabras
    pueden repartirse entre campos ("grecia botox": vendedora y servicio)."""
    return or_(
        false(),
        *_every_term(search, lambda pattern: _identity_fields(pattern) + _crm_fields(pattern)),
        *_phone_digit_conditions(search),
    )


def _message_text_column(search: str):
    """El campo del mensaje que contiene las palabras, para mostrarlo y que el
    resaltado las encuentre. Si el match fue en el análisis IA (p. ej. audios,
    donde `content` es NULL), es ese resumen y no un preview vacío."""
    in_content = and_(true(), *[_unaccent_ilike(WspMessage.content, pattern) for pattern in _patterns(search)])
    return case((in_content, WspMessage.content), else_=WspMessage.analysis["summary"].astext)


def _message_text_match(search: str):
    """Un mensaje matchea si todas las palabras aparecen en su texto humano o
    en el resumen del análisis IA del adjunto. Lo segundo es lo que hace que
    buscar "yape" encuentre el comprobante cuya descripción generó la IA,
    aunque el cliente no haya escrito nada. El índice trigram sobre
    f_unaccent(analysis->>'summary') (idx_wsp_messages_analysis_trgm) evita el
    recorrido completo.

    Los eliminados quedan fuera: su texto ya no se sirve en ningún lado, así
    que tampoco puede aparecer como preview de un resultado de búsqueda."""
    patterns = _patterns(search)
    if not patterns:
        return false()
    summary = WspMessage.analysis["summary"].astext
    return and_(
        WspMessage.deleted_at.is_(None),
        or_(
            and_(*[_unaccent_ilike(WspMessage.content, pattern) for pattern in patterns]),
            and_(*[_unaccent_ilike(summary, pattern) for pattern in patterns]),
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
    return or_(_contact_search_condition(search), _message_match_condition(search))


def _search_rank_expression(search: str):
    """Sección del resultado, como WhatsApp: 2 = match por nombre/teléfono,
    1 = match por campos CRM (vendedor/servicio/origen), 0 = solo por un
    mensaje del historial. Los coalesce evitan que un NULL (p. ej. nombre
    vacío) descoloque la fila en el ORDER BY."""
    return case(
        (func.coalesce(_identity_match(search), false()), 2),
        (func.coalesce(_contact_search_condition(search), false()), 1),
        else_=0,
    )


def _matched_message_subquery(search: str, column=None):
    """Mensaje más reciente que contiene el término: su contenido se muestra
    en el preview del resultado (como WhatsApp) y su id permite saltar hasta
    él al abrir la conversación."""
    if column is None:
        column = _message_text_column(search)
    return (
        select(column)
        .where(
            WspMessage.chat_id == Lead.id,
            _message_text_match(search),
        )
        .order_by(WspMessage.sent_at.desc(), WspMessage.id.desc())
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
        Lead.nombre_usuario.label("username"),
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
        last_message.c.message_subtype.label("last_message_subtype"),
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


@dataclass(frozen=True)
class LeadFilters:
    """Los filtros de la bandeja sobre el lead. Los comparten la lista de
    chats y la búsqueda por mensaje: con "No leídos" o "Mis leads" activos,
    las dos secciones del buscador muestran lo mismo."""

    unread_only: bool = False
    stages: tuple[str, ...] | None = None
    tag_ids: tuple[int, ...] | None = None
    tag_mode: str = "any"
    service: str | None = None
    seller_id: int | None = None
    origin: str | None = None
    last_sender: str | None = None
    inactive_days: int | None = None
    waiting_time: str | None = None
    automation_paused: bool = False

    @property
    def needs_last_message(self) -> bool:
        """Estos tres filtran por el último mensaje del chat: quien arma la
        consulta tiene que haber hecho el JOIN lateral."""
        return (
            self.last_sender in ("cliente", "vendedor")
            or bool(self.inactive_days and self.inactive_days > 0)
            or self.waiting_time in ("any", "fresh", "warning", "urgent")
        )


def _apply_lead_filters(stmt, last_message, filters: LeadFilters):
    if filters.unread_only:
        stmt = stmt.where(_has_unread_messages_condition())

    if filters.automation_paused:
        stmt = stmt.where(Lead.automatizacion_pausada.is_(True))

    if filters.stages:
        stmt = stmt.where(Lead.estado.in_(filters.stages))
    if filters.tag_ids:
        tag_conditions = [_has_tag_condition(tag_id) for tag_id in filters.tag_ids]
        stmt = stmt.where(and_(*tag_conditions) if filters.tag_mode == "all" else or_(*tag_conditions))
    if filters.service:
        stmt = stmt.where(Lead.servicio_interes.ilike(f"%{filters.service}%"))
    if filters.seller_id is not None:
        stmt = stmt.where(Lead.vendedor_id == filters.seller_id)
    if filters.origin:
        stmt = stmt.where(Lead.origen.ilike(f"%{filters.origin}%"))
    if filters.last_sender in ("cliente", "vendedor"):
        stmt = stmt.where(last_message.c.sender == filters.last_sender)
    if filters.inactive_days is not None and filters.inactive_days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=filters.inactive_days)
        stmt = stmt.where(or_(last_message.c.sent_at < cutoff, last_message.c.sent_at.is_(None)))
    if filters.waiting_time in ("any", "fresh", "warning", "urgent"):
        now = datetime.now(timezone.utc)
        warning_cutoff = now - timedelta(minutes=10)
        urgent_cutoff = now - timedelta(hours=1)
        stmt = stmt.where(last_message.c.sender == "cliente")
        if filters.waiting_time == "fresh":
            stmt = stmt.where(last_message.c.sent_at > warning_cutoff)
        elif filters.waiting_time == "warning":
            stmt = stmt.where(
                last_message.c.sent_at <= warning_cutoff,
                last_message.c.sent_at > urgent_cutoff,
            )
        elif filters.waiting_time == "urgent":
            stmt = stmt.where(last_message.c.sent_at <= urgent_cutoff)
    return stmt


SEARCH_IN_ALL = "all"
SEARCH_IN_CONTACTS = "contacts"


async def fetch_chats(
    search: str | None = None,
    cursor_ts: str | None = None,
    cursor_id: str | None = None,
    limit: int = CHATS_PAGE_SIZE,
    filters: LeadFilters | None = None,
    cursor_rank: int | None = None,
    search_in: str = SEARCH_IN_ALL,
) -> dict:
    """`search_in="contacts"` deja solo los leads que matchean por sus datos:
    los que matchean por un mensaje los lista `search_chat_messages`, uno por
    mensaje. El valor por defecto conserva la lista mezclada de antes, que
    siguen pidiendo las versiones anteriores de la app y la búsqueda de
    duplicados por teléfono."""
    filters = filters or LeadFilters()
    contacts_only = bool(search) and search_in == SEARCH_IN_CONTACTS
    last_message = _last_message_subquery()

    columns = list(_chat_columns(last_message))
    if search:
        columns.append(_search_rank_expression(search).label("search_rank"))
        if not contacts_only:
            columns.append(_matched_message_subquery(search).label("matched_message"))
            columns.append(_matched_message_subquery(search, WspMessage.id).label("matched_message_id"))

    stmt = (
        select(*columns)
        .join(last_message, true(), isouter=True)
        .where(await _visible_lead_condition())
    )

    if search:
        stmt = stmt.where(_contact_search_condition(search) if contacts_only else _chat_search_condition(search))

    stmt = _apply_lead_filters(stmt, last_message, filters)

    # El total va solo en la primera página de "Contactos": la sección muestra
    # unos pocos y dice cuántos hay. La lista sin búsqueda no lo necesita.
    total_stmt = None
    if contacts_only and cursor_id is None:
        total_stmt = select(func.count()).select_from(stmt.with_only_columns(Lead.id).subquery())

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

    async with session_scope() as session:
        rows = (await session.execute(stmt)).mappings().all()
        page_rows = rows[:limit]
        tags_by_lead = await _tags_by_lead(session, [row["chat_id"] for row in page_rows])
        total = int(await session.scalar(total_stmt) or 0) if total_stmt is not None else None

    has_more = len(rows) > limit
    return {
        "items": [_row_to_chat(row, tags_by_lead.get(row["chat_id"])) for row in page_rows],
        "has_more": has_more,
        "total": total,
    }


# Con menos letras la búsqueda matchea media base y no puede usar el índice
# trigram: el buscador muestra contactos y espera a que se escriba más.
MIN_MESSAGE_SEARCH_CHARS = 2
# Contar todos los mensajes que dicen "hola" recorre el historial entero para
# mostrar un número que nadie lee: pasado el tope se muestra "1000+".
MESSAGE_SEARCH_COUNT_CAP = 1000


async def search_chat_messages(
    search: str,
    cursor_ts: str | None = None,
    cursor_id: int | None = None,
    limit: int = CHATS_PAGE_SIZE,
    filters: LeadFilters | None = None,
) -> dict:
    """Los mensajes que contienen la búsqueda, del más nuevo al más viejo y
    uno por fila: el mismo chat sale tantas veces como mensajes matcheen.

    La lista de chats mostraba un solo mensaje por chat —el más reciente—, así
    que quien buscaba un texto que ya había mandado no podía elegir cuál ni
    ver a quiénes más se lo mandó; en WhatsApp sí (queja de las vendedoras,
    2026-11-11).
    """
    filters = filters or LeadFilters()
    if sum(len(term) for term in search_terms(search)) < MIN_MESSAGE_SEARCH_CHARS:
        return {"items": [], "has_more": False, "total": 0, "total_capped": False}

    stmt = (
        select(
            WspMessage.id.label("message_id"),
            Lead.id.label("chat_id"),
            Lead.nombre.label("name"),
            Lead.nombre_usuario.label("username"),
            Lead.telefono.label("phone"),
            _message_text_column(search).label("text"),
            WspMessage.sender,
            WspMessage.message_type,
            WspMessage.sent_at,
        )
        .select_from(WspMessage)
        .join(Lead, Lead.id == WspMessage.chat_id)
        .where(await _visible_lead_condition(), _message_text_match(search))
    )
    last_message = _last_message_subquery()
    if filters.needs_last_message:
        stmt = stmt.join(last_message, true(), isouter=True)
    stmt = _apply_lead_filters(stmt, last_message, filters)

    total_stmt = None
    if cursor_id is None:
        capped = stmt.with_only_columns(WspMessage.id).limit(MESSAGE_SEARCH_COUNT_CAP + 1)
        total_stmt = select(func.count()).select_from(capped.subquery())

    if cursor_id is not None and cursor_ts is not None:
        parsed_ts = _parse_ts(cursor_ts)
        stmt = stmt.where(or_(
            WspMessage.sent_at < parsed_ts,
            and_(WspMessage.sent_at == parsed_ts, WspMessage.id < cursor_id),
        ))
    stmt = stmt.order_by(WspMessage.sent_at.desc(), WspMessage.id.desc()).limit(limit + 1)

    async with session_scope() as session:
        rows = (await session.execute(stmt)).mappings().all()
        found = int(await session.scalar(total_stmt) or 0) if total_stmt is not None else None

    return {
        "items": [
            {
                "message_id": row["message_id"],
                "chat_id": row["chat_id"],
                "name": row["name"],
                "username": row["username"],
                "phone": row["phone"],
                "text": row["text"],
                "sender": row["sender"],
                "message_type": row["message_type"],
                "sent_at": _fmt_ts(row["sent_at"]),
            }
            for row in rows[:limit]
        ],
        "has_more": len(rows) > limit,
        "total": min(found, MESSAGE_SEARCH_COUNT_CAP) if found is not None else None,
        "total_capped": found is not None and found > MESSAGE_SEARCH_COUNT_CAP,
    }


async def fetch_chat(chat_id: str) -> dict | None:
    last_message = _last_message_subquery()
    stmt = (
        select(*_chat_columns(last_message))
        .join(last_message, true(), isouter=True)
        .where(Lead.id == chat_id)
    )
    async with session_scope() as session:
        row = (await session.execute(stmt)).mappings().first()
        tags_by_lead = await _tags_by_lead(session, [chat_id]) if row is not None else {}

    return _row_to_chat(row, tags_by_lead.get(chat_id)) if row is not None else None


async def get_customer_service_window(chat_id: str) -> dict | None:
    """Las dos ventanas de Meta para un chat, que miden cosas distintas.

    - Atención (24 h desde el último mensaje del cliente): decide si se puede
      mandar texto libre o solo plantillas.
    - Gratis por anuncio (Free Entry Point, hasta 7 días): decide si Meta
      cobra. No habilita texto libre pasadas las 24 h.
    """
    customer = and_(WspMessage.chat_id == Lead.id, WspMessage.sender == "cliente")
    last_customer_message = (
        select(func.max(WspMessage.sent_at)).where(customer).correlate(Lead).scalar_subquery()
    )
    # El primer mensaje de quien toca un anuncio Click-to-WhatsApp trae
    # ``referral`` (ver el procesador del webhook).
    last_ad_message = (
        select(func.max(WspMessage.sent_at))
        .where(customer, WspMessage.provider_payload.has_key("referral"))
        .correlate(Lead)
        .scalar_subquery()
    )
    entry_point_expires = (
        select(WhatsAppEntryPointWindow.expires_at)
        .where(WhatsAppEntryPointWindow.chat_id == Lead.id)
        .correlate(Lead)
        .scalar_subquery()
    )
    async with session_scope() as session:
        row = (await session.execute(
            select(
                Lead.id,
                last_customer_message.label("last_customer_message_at"),
                last_ad_message.label("last_ad_message_at"),
                entry_point_expires.label("free_entry_point_expires_at"),
            )
            .where(Lead.id == chat_id)
        )).mappings().one_or_none()
        if row is None:
            return None
        ad_at = row["last_ad_message_at"]
        # Ya se le respondió después del anuncio: si Meta abrió la ventana,
        # el webhook de ese envío la informa; si no la abrió (clic desde
        # WhatsApp Web o respuesta tardía), no hay nada que ofrecer.
        replied_after_ad = bool(ad_at) and bool(await session.scalar(
            select(exists().where(
                WspMessage.chat_id == chat_id,
                WspMessage.sender != "cliente",
                WspMessage.sent_at > ad_at,
                WspMessage.meta_status.in_(("sent", "delivered", "read")),
            ))
        ))

    now = datetime.now(timezone.utc)
    last_customer_message_at = row["last_customer_message_at"]
    expires_at = last_customer_message_at + CUSTOMER_SERVICE_WINDOW if last_customer_message_at else None
    seconds_remaining = max(0, int((expires_at - now).total_seconds())) if expires_at else 0

    entry_point_expires_at = row["free_entry_point_expires_at"]
    entry_point_open = bool(entry_point_expires_at and entry_point_expires_at > now)
    ad_reply_deadline = ad_at + AD_REPLY_WINDOW if ad_at else None
    offer_open = (
        ad_reply_deadline is not None
        and ad_reply_deadline > now
        and not replied_after_ad
        and not entry_point_open
    )
    return {
        "is_open": seconds_remaining > 0,
        "last_customer_message_at": _fmt_ts(last_customer_message_at),
        "expires_at": _fmt_ts(expires_at),
        "seconds_remaining": seconds_remaining,
        "free_entry_point_open": entry_point_open,
        "free_entry_point_expires_at": _fmt_ts(entry_point_expires_at) if entry_point_open else None,
        "ad_reply_deadline": _fmt_ts(ad_reply_deadline) if offer_open else None,
    }


async def lead_exists(chat_id: str) -> bool:
    """Validación ligera para operaciones que no necesitan la ventana de servicio."""
    stmt = select(exists().where(Lead.id == chat_id))
    async with session_scope() as session:
        return bool(await session.scalar(stmt))
