import asyncio
from datetime import datetime, timedelta, timezone

from sqlalchemy import bindparam, select, update

from db.models import WspMessage
from db.session import get_sessionmaker
from services.store.common import (
    MEDIA_DIMENSION_CONCURRENCY,
)
from services.store.messages import (
    insert_message,
)

# Ventana para casar el eco de Evolution (análisis IA de la media saliente) con
# la fila que ya guardó la app. Generosa porque el análisis de un video puede
# tardar; acotada para no pegarle a un envío viejo del mismo tipo.
OUTGOING_ANALYSIS_WINDOW = timedelta(minutes=15)


async def attach_outgoing_analysis(
    chat_id: str,
    message_type: str,
    analysis: dict,
    *,
    wa_message_id: str | None = None,
    content: str | None = None,
    media_url: str | None = None,
) -> dict:
    """Adjunta el análisis IA de una media SALIENTE del vendedor a su fila, o
    inserta una fila nueva si no la encuentra.

    El vendedor manda una imagen/video/audio desde la app: la app guarda la fila
    con el archivo pero sin análisis. Evolution reenvía ese mensaje por webhook y
    n8n le corre el análisis IA; este helper lo mergea en la fila de la app en
    vez de crear un duplicado.

    Match: por wa_message_id si aparece; si no, el mensaje más reciente del
    vendedor de ese tipo, en el chat, sin análisis, dentro de la ventana. Los
    wa_message_id del envío (respuesta de Evolution) y del eco (webhook) no
    coinciden, así que la recencia es el camino real. Si no hay match (media
    enviada desde el teléfono, no la app) se inserta la fila, para no perderla.
    """
    async with get_sessionmaker()() as session:
        row = None
        if wa_message_id:
            row = (await session.execute(
                select(WspMessage).where(
                    WspMessage.chat_id == chat_id,
                    WspMessage.wa_message_id == wa_message_id,
                )
            )).scalar_one_or_none()

        if row is None:
            window_start = datetime.now(timezone.utc) - OUTGOING_ANALYSIS_WINDOW
            row = (await session.execute(
                select(WspMessage)
                .where(
                    WspMessage.chat_id == chat_id,
                    WspMessage.sender == "vendedor",
                    WspMessage.message_type == message_type,
                    WspMessage.analysis.is_(None),
                    WspMessage.sent_at >= window_start,
                )
                .order_by(WspMessage.sent_at.desc(), WspMessage.id.desc())
                .limit(1)
            )).scalar_one_or_none()

        if row is not None:
            row.analysis = analysis
            await session.commit()
            return {"matched": True, "message_id": row.id}

    inserted = await insert_message(
        chat_id=chat_id,
        sender="vendedor",
        content=content,
        media_url=media_url,
        wa_message_id=wa_message_id,
        message_type=message_type,
        analysis=analysis,
    )
    return {"matched": False, "message_id": inserted["id"]}


OUTGOING_RECONCILE_WINDOW = timedelta(minutes=5)

# Solo estos tipos pueden ser enviados por la aplicación y luego regresar con
# otro wa_message_id en el eco de Evolution. Los mensajes estructurados que se
# originan exclusivamente en WhatsApp (por ejemplo orderMessage) no deben
# conciliarse por similitud: dos cambios del mismo pedido pueden compartir tipo
# y texto vacío y, aun así, ser eventos distintos que hay que conservar.
OUTGOING_FUZZY_RECONCILE_TYPES = frozenset({
    "text",
    "image",
    "video",
    "ptv",
    "audio",
    "document",
    "location",
    "sticker",
    "contact",
    "poll",
    "reaction",
    "interactive",
    "template",
})


async def reconcile_outgoing_message(
    chat_id: str,
    message_type: str,
    content: str | None,
    *,
    wa_message_id: str | None = None,
    media_url: str | None = None,
    payload: dict | None = None,
    human_reply: bool = False,
    message_secret: bytes | None = None,
) -> dict:
    """Guarda un mensaje SALIENTE (fromMe) que llega por el eco de Evolution,
    salvo que sea un duplicado de algo que ya mandó nuestra app.

    El eco de nuestros propios envíos ya está guardado (lo guarda la app al
    enviar); insertarlo de nuevo lo duplicaría. Pero los salientes que NO mandó
    la app —el auto-reply de una herramienta externa (Kommo), o un mensaje
    escrito desde el teléfono— solo llegan por este eco y hay que conservarlos.

    Dedup: primero se casa el identificador exacto. Solo para tipos que la app
    puede enviar se permite además una conciliación difusa por tipo/contenido
    dentro de la ventana, porque el ID del envío y el del eco pueden diferir.
    Tipos externos/estructurados (order, unsupported) se insertan siempre que
    su ID sea nuevo, para no perder eventos sucesivos con contenido vacío.

    `message_secret` (ver services/message_edit_crypto.py) solo lo trae el eco,
    nunca el insert original de la app —que no sabe todavía qué le va a
    contestar Evolution—, así que cuando hay match se escribe acá encima de la
    fila ya existente en vez de perderse."""
    async with get_sessionmaker()() as session:
        existing = None
        if wa_message_id:
            existing = (await session.execute(
                select(WspMessage.id).where(
                    WspMessage.chat_id == chat_id,
                    WspMessage.wa_message_id == wa_message_id,
                ).limit(1)
            )).first()

        if existing is None and message_type in OUTGOING_FUZZY_RECONCILE_TYPES:
            window_start = datetime.now(timezone.utc) - OUTGOING_RECONCILE_WINDOW
            existing = (await session.execute(
                select(WspMessage.id).where(
                    WspMessage.chat_id == chat_id,
                    WspMessage.sender == "vendedor",
                    WspMessage.message_type == message_type,
                    WspMessage.content.is_not_distinct_from(content),
                    WspMessage.sent_at >= window_start,
                ).limit(1)
            )).first()
        if existing is not None:
            if message_secret is not None:
                await session.execute(
                    update(WspMessage)
                    .where(WspMessage.id == existing.id)
                    .values(message_secret=message_secret)
                )
                await session.commit()
            return {"matched": True}

    inserted = await insert_message(
        chat_id=chat_id,
        sender="vendedor",
        content=content,
        media_url=media_url,
        wa_message_id=wa_message_id,
        status="SERVER_ACK",
        message_type=message_type,
        payload=payload,
        human_outbound=human_reply,
        message_secret=message_secret,
    )
    return {"matched": False, "message_id": inserted["id"]}


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
