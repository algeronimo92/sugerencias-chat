"""Dimensiones de imágenes y videos, completadas la primera vez que se leen.

El frontend reserva el espacio exacto de cada adjunto antes de que cargue.
Los mensajes viejos no traen ``media_width``/``media_height``: el historial
los mide al servirlos y los guarda una sola vez (0/0 marca los que no se
pudieron medir, para no reintentarlos en cada apertura).

Medir y guardar están separados de la lectura: medir descarga archivos y no
retiene una conexión de la base, y guardar es un comando con su propia
transacción. Si guardar falla, la página se sirve igual con lo medido.
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import bindparam, update

from app.db.models.conversations import WspMessage
from app.db.uow import session_scope
from app.modules.conversations.chat_rows import MEDIA_DIMENSION_CONCURRENCY

logger = logging.getLogger(__name__)


def _pending(rows: list[dict]) -> list[dict]:
    return [
        row for row in rows
        if row["media_url"] and row["media_width"] is None
        and row["message_type"] in ("image", "video")
    ]


async def measure_media_dimensions(rows: list[dict]) -> list[dict]:
    """Mide los adjuntos de ``rows`` que todavía no tienen dimensiones y las
    deja en cada fila. Devuelve las filas medidas."""
    from app.integrations.storage.media_storage import image_dimensions, video_dimensions

    pending = _pending(rows)
    if not pending:
        return []

    # Medir en serie hacía que cada archivo esperara al anterior: con el
    # almacenamiento en otra región, una página con varias imágenes sumaba
    # segundos al GET del historial. El límite evita saturar el pool de hilos
    # y abrir demasiadas descargas simultáneas.
    limiter = asyncio.Semaphore(MEDIA_DIMENSION_CONCURRENCY)

    async def measure(row: dict) -> tuple[int, int] | None:
        fn = image_dimensions if row["message_type"] == "image" else video_dimensions
        async with limiter:
            return await asyncio.to_thread(fn, row["media_url"])

    measured = await asyncio.gather(*(measure(row) for row in pending), return_exceptions=True)
    for row, dims in zip(pending, measured):
        if isinstance(dims, BaseException) or not dims:
            dims = (0, 0)
        row["media_width"], row["media_height"] = dims
    return pending


async def save_media_dimensions(rows: list[dict]) -> None:
    """Guarda las dimensiones medidas, en una transacción propia."""
    if not rows:
        return
    # Usar la tabla (SQL Core) evita que SQLAlchemy interprete la lista de
    # parámetros como ORM Bulk UPDATE by Primary Key. Ese modo exige que cada
    # mapping contenga la propiedad ORM `id` y no admite este WHERE parametrizado.
    async with session_scope() as session:
        await session.execute(
            update(WspMessage.__table__)
            .where(WspMessage.__table__.c.id == bindparam("row_id"))
            .values(media_width=bindparam("width"), media_height=bindparam("height")),
            [
                {"row_id": row["id"], "width": row["media_width"], "height": row["media_height"]}
                for row in rows
            ],
        )


async def complete_media_dimensions(rows: list[dict]) -> None:
    measured = await measure_media_dimensions(rows)
    try:
        await save_media_dimensions(measured)
    except Exception:
        logger.exception("No se pudieron guardar las dimensiones de %s adjuntos", len(measured))
