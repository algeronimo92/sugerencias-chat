import asyncio
from datetime import datetime

from sqlalchemy import and_, bindparam, func, or_, select, update

from db.models import Lead, MessageOutbox, WspMessage
from db.session import get_sessionmaker
from services.store.common import (
    MEDIA_DIMENSION_CONCURRENCY,
    MESSAGES_PAGE_SIZE,
)
from services.store.message_serialization import serialize_message

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
                WspMessage.chat_id,
                WspMessage.sender,
                WspMessage.direction,
                WspMessage.content,
                WspMessage.sent_at,
                WspMessage.media_url,
                WspMessage.wa_message_id,
                WspMessage.outbox_status,
                WspMessage.meta_status,
                WspMessage.status_payload,
                WspMessage.media_width,
                WspMessage.media_height,
                WspMessage.quoted_wa_message_id,
                WspMessage.message_type,
                WspMessage.message_subtype,
                WspMessage.provider_payload,
                WspMessage.analysis,
                WspMessage.payload,
                WspMessage.reactions,
                WspMessage.edited_at,
                WspMessage.deleted_at,
                WspMessage.pinned_at,
                # Motivo real de un envío que el outbox dio por fallido, para
                # que la burbuja muestre algo más útil que "No enviado".
                MessageOutbox.last_error,
            )
            .outerjoin(MessageOutbox, MessageOutbox.message_id == WspMessage.id)
            .where(WspMessage.chat_id == chat_id)
            # Las reacciones son eventos (whatsapp_message_events) que se ven
            # como badge sobre su objetivo, nunca como burbuja propia.
            .where(WspMessage.message_type.is_distinct_from("reaction"))
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
        {
            **serialize_message(r),
            # Solo tiene sentido junto a un envío fallido del outbox: para un
            # reintento exitoso, last_error queda de un intento que ya no aplica.
            "error_detail": r["last_error"] if r["outbox_status"] == "failed" else None,
            **quoted.get(r["quoted_wa_message_id"], {}),
        }
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
            WspMessage.provider_payload,
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
    cambiar si después respondió un vendedor, y Meta identifica el mensaje
    reaccionado por su ``wa_message_id``.
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


async def _fill_media_dimensions(session, rows: list[dict]) -> None:
    """Completa y persiste media_width/height de imágenes y videos que aún no
    lo tienen, para que el frontend reserve el espacio exacto antes de que
    carguen. Corre una sola vez por mensaje (backfill perezoso); 0/0 marca
    los que no se pudieron medir para no reintentarlos en cada apertura."""
    from services.media_storage import image_dimensions, video_dimensions

    pending = [
        r for r in rows
        if r["media_url"] and r["media_width"] is None
        and r["message_type"] in ("image", "video")
    ]
    if not pending:
        return

    # Medir en serie hacía que cada archivo esperara al anterior: con el
    # almacenamiento en otra región, una página con varias imágenes sumaba
    # segundos al GET del historial. El límite evita saturar el pool de hilos
    # y abrir demasiadas descargas simultáneas.
    limiter = asyncio.Semaphore(MEDIA_DIMENSION_CONCURRENCY)

    async def measure(row: dict) -> tuple[int, int] | None:
        fn = image_dimensions if row["message_type"] == "image" else video_dimensions
        async with limiter:
            return await asyncio.to_thread(fn, row["media_url"])

    measured = await asyncio.gather(
        *(measure(row) for row in pending), return_exceptions=True
    )

    for row, dims in zip(pending, measured):
        if isinstance(dims, BaseException) or not dims:
            # 0/0 marca "no medible" para no reintentarlo en cada apertura.
            dims = (0, 0)
        row["media_width"], row["media_height"] = dims

    # Usar la tabla (SQL Core) evita que SQLAlchemy interprete la lista de
    # parámetros como ORM Bulk UPDATE by Primary Key. Ese modo exige que cada
    # mapping contenga la propiedad ORM `id` y no admite este WHERE parametrizado.
    await session.execute(
        update(WspMessage.__table__)
        .where(WspMessage.__table__.c.id == bindparam("row_id"))
        .values(media_width=bindparam("width"), media_height=bindparam("height")),
        [
            {"row_id": row["id"], "width": row["media_width"], "height": row["media_height"]}
            for row in pending
        ],
    )
    await session.commit()
