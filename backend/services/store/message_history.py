from datetime import datetime

from sqlalchemy import and_, func, not_, or_, select

from db.models import Lead, MessageOutbox, WspMessage
from db.session import get_sessionmaker
from services.store.common import (
    MESSAGES_PAGE_SIZE,
    _fmt_ts,
)
from services.store.message_edits import (
    _mask_deleted,
)
from services.store.outgoing_reconcile import (
    _fill_media_dimensions,
)

# Techo del salto a un mensaje de búsqueda: evita cargar una conversación
# gigante entera si el match está muy atrás en el historial.
JUMP_TO_MESSAGE_MAX = 1000

# Envoltorios de un álbum de WhatsApp sin contenido propio (ver
# automation_rules.IGNORED_ORIGINAL_TYPES, que además excluye
# `secretEncryptedMessage` de las automatizaciones pero no del hilo: ese sí se
# deja visible para poder notar qué otras acciones cifradas manda esta
# cuenta).
ALBUM_ENVELOPE_TYPES = frozenset({"albumMessage", "associatedChildMessage"})


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
                WspMessage.quoted_wa_message_id,
                WspMessage.message_type,
                WspMessage.analysis,
                WspMessage.payload,
                WspMessage.reactions,
                WspMessage.edited_at,
                WspMessage.deleted_at,
                WspMessage.pinned_at,
                # Motivo real de un status='FAILED' -por qué el outbox se
                # rindió-, para que la burbuja muestre algo más útil que un
                # genérico "No enviado". NULL para todo lo que no pasó por el
                # outbox (entrantes) o que sí salió.
                MessageOutbox.last_error,
            )
            .outerjoin(MessageOutbox, MessageOutbox.message_id == WspMessage.id)
            .where(WspMessage.chat_id == chat_id)
            # Las reacciones no son burbujas: viven como badge sobre el mensaje
            # objetivo (columna reactions). Las filas legadas de tipo reaction
            # quedan fuera del hilo. is_distinct_from trata bien el NULL de las
            # filas todavía sin backfillear (message_type NULL sigue entrando).
            .where(WspMessage.message_type.is_distinct_from("reaction"))
            # El "sobre" de un álbum (`albumMessage`/`associatedChildMessage`) no
            # aporta nada que mostrar: las fotos reales llegan aparte como sus
            # propios `imageMessage`/`videoMessage` y sí se ven. A diferencia de
            # `automation_rules.IGNORED_ORIGINAL_TYPES` (que también excluye
            # `secretEncryptedMessage`), ese tipo se deja visible acá a propósito:
            # es la única forma de notar en el hilo qué otras acciones cifradas
            # manda esta cuenta además de la edición ya soportada.
            .where(not_(and_(
                WspMessage.message_type == "unsupported",
                WspMessage.payload["original_type"].astext.in_(ALBUM_ENVELOPE_TYPES),
            )))
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
        quoted = await _resolve_quoted_messages(session, chat_id, page)

    items = [
        _mask_deleted({
            "id": r["id"],
            "sender": r["sender"],
            "content": r["content"],
            "sent_at": _fmt_ts(r["sent_at"]),
            "media_url": r["media_url"],
            "wa_message_id": r["wa_message_id"],
            "status": r["status"],
            "message_type": r["message_type"],
            "analysis": r["analysis"],
            "payload": r["payload"],
            "reactions": r["reactions"],
            "edited_at": _fmt_ts(r["edited_at"]),
            "deleted_at": _fmt_ts(r["deleted_at"]),
            "pinned_at": _fmt_ts(r["pinned_at"]),
            # 0/0 (= no medible) no le sirve al frontend: se expone como None.
            "media_width": r["media_width"] or None,
            "media_height": r["media_height"] or None,
            # Solo tiene sentido mostrarlo junto al estado FAILED: para
            # cualquier otro estado es ruido (y para uno ya reintentado con
            # éxito, last_error queda de un intento anterior que ya no aplica).
            "error_detail": r["last_error"] if r["status"] == "FAILED" else None,
            **quoted.get(r["quoted_wa_message_id"], {}),
        })
        for r in page
    ]
    return {"items": items, "has_more": has_more}


async def _resolve_quoted_messages(session, chat_id: str, rows: list[dict]) -> dict[str, dict]:
    """Mapea wa_message_id citado -> datos del mensaje original.

    Una sola consulta para toda la página. Los citados que no estén en la
    base (histórico anterior a la integración, o mensajes enviados desde el
    teléfono) sencillamente no aparecen en el mapa: el frontend no dibuja la
    cita en vez de mostrar un bloque vacío.
    """
    wanted = {r["quoted_wa_message_id"] for r in rows if r["quoted_wa_message_id"]}
    if not wanted:
        return {}

    quoted_rows = (await session.execute(
        select(
            WspMessage.id,
            WspMessage.sender,
            WspMessage.content,
            WspMessage.wa_message_id,
            WspMessage.message_type,
        ).where(
            WspMessage.chat_id == chat_id,
            WspMessage.wa_message_id.in_(wanted),
        )
    )).mappings().all()

    return {
        r["wa_message_id"]: {
            "quoted_message_id": r["id"],
            "quoted_sender": r["sender"],
            "quoted_content": r["content"],
            # El tipo permite que la cita muestre "📷 Imagen" aunque `content`
            # venga vacío (los adjuntos ya no llevan el tipo embebido en content).
            "quoted_message_type": r["message_type"],
        }
        for r in quoted_rows
    }


async def fetch_reply_target(chat_id: str, message_id: int) -> dict | None:
    """Mensaje al que se quiere responder, o None si no existe en el chat.

    Devuelve `wa_message_id` sin filtrar por él a propósito: un mensaje del
    vendedor todavía en la outbox existe pero aún no tiene id de WhatsApp, y
    el llamador necesita distinguir "no existe" de "todavía no se puede
    citar" para dar el error correcto.

    También lo usan editar y eliminar, que necesitan además el tipo y la fecha
    de envío para poder aplicar los límites de WhatsApp (solo texto, 15
    minutos) antes de llamar a Evolution.
    """
    stmt = select(
        WspMessage.id,
        WspMessage.sender,
        WspMessage.content,
        WspMessage.wa_message_id,
        WspMessage.message_type,
        WspMessage.sent_at,
        WspMessage.deleted_at,
    ).where(WspMessage.id == message_id, WspMessage.chat_id == chat_id)
    async with get_sessionmaker()() as session:
        row = (await session.execute(stmt)).mappings().first()
    return dict(row) if row is not None else None


async def fetch_messages_to_forward(chat_id: str, message_ids: list[int]) -> list[dict]:
    """Mensajes de ``chat_id`` que se van a reenviar, en orden de conversación.

    Reenviar no toca WhatsApp del lado del original: se vuelve a enviar lo que
    tenemos guardado (texto, archivo, ubicación) al chat destino, así que acá
    alcanza con el contenido — no hace falta ``wa_message_id``. Los eliminados
    se filtran: de esos ya no servimos el contenido.

    El orden lo pone la base y no la lista pedida: reenviar cinco mensajes
    tiene que reproducir la conversación tal cual se leyó, no el orden en que
    se fueron tildando.
    """
    if not message_ids:
        return []
    stmt = (
        select(
            WspMessage.id,
            WspMessage.sender,
            WspMessage.content,
            WspMessage.media_url,
            WspMessage.message_type,
            WspMessage.payload,
        )
        .where(
            WspMessage.chat_id == chat_id,
            WspMessage.id.in_(message_ids),
            WspMessage.deleted_at.is_(None),
        )
        .order_by(WspMessage.sent_at.asc(), WspMessage.id.asc())
    )
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).mappings().all()
    return [dict(row) for row in rows]


async def filter_existing_leads(chat_ids: list[str]) -> set[str]:
    """Cuáles de esos chats existen como lead. Una consulta para todos."""
    if not chat_ids:
        return set()
    stmt = select(Lead.id).where(Lead.id.in_(chat_ids))
    async with get_sessionmaker()() as session:
        return set((await session.execute(stmt)).scalars().all())


async def fetch_latest_customer_message_target(chat_id: str) -> dict | None:
    """Último mensaje real del cliente al que WhatsApp permite reaccionar.

    Se filtra por remitente y por ``wa_message_id``: el objetivo no debe
    cambiar si después respondió un vendedor, y una fila aún no confirmada en
    WhatsApp no sirve para construir la key de Evolution API.
    """
    stmt = (
        select(WspMessage.id, WspMessage.wa_message_id)
        .where(
            WspMessage.chat_id == chat_id,
            WspMessage.sender == "cliente",
            WspMessage.wa_message_id.isnot(None),
            WspMessage.wa_message_id != "",
        )
        .order_by(WspMessage.sent_at.desc(), WspMessage.id.desc())
        .limit(1)
    )
    async with get_sessionmaker()() as session:
        row = (await session.execute(stmt)).mappings().first()
    return dict(row) if row is not None else None
