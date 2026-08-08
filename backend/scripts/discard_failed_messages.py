"""Cierra en lote los envíos fallidos que ya se revisaron y no se van a reenviar.

Es la versión masiva del botón "Descartar" de la burbuja
(``services.message_outbox.discard_failed_message``) y aplica exactamente el
mismo cambio: el job pasa de ``failed`` a ``discarded`` y su mensaje de
``FAILED`` a ``DISCARDED``. No borra nada — el mensaje nunca llegó al cliente y
el historial lo sigue diciendo.

Existe por el arrastre histórico: ``message_outbox`` no se purga y un job solo
sale de ``failed`` por reintento manual, así que los fallos viejos que nadie
reintentó se acumulan para siempre y mantienen ``outbox_failed`` por encima de
cualquier umbral.

IMPORTANTE: correr solo con el backend y el frontend nuevos ya desplegados. Una
versión anterior del frontend no conoce el estado DISCARDED y cae a su rama por
defecto, que pinta el tique gris de "Enviado" — justo lo contrario de lo que
pasó con estos mensajes.

Por defecto solo toca fallos con más de ``--older-than-hours`` horas (24) para
no cerrar de un plumazo un incidente que todavía está pasando, y solo simula:
escribe únicamente con ``--apply``.

Uso desde el contenedor del backend::

    python -m scripts.discard_failed_messages
    python -m scripts.discard_failed_messages --apply
"""

import argparse
import asyncio
from collections import Counter
from datetime import datetime, timedelta, timezone

from sqlalchemy import select, update

from db.models import MessageOutbox, WspMessage
from db.session import close_engine, get_sessionmaker

DEFAULT_OLDER_THAN_HOURS = 24
# Los last_error son largos (traceback de Evolution); para el resumen alcanza
# el principio, que es lo que distingue una causa de otra.
ERROR_PREVIEW_CHARS = 80


async def _candidates(cutoff: datetime, limit: int | None) -> list[tuple[int, int, str | None]]:
    """(id del job, id del mensaje, last_error) de los fallos cerrables.

    Mismo WHERE que ``discard_failed_message``: exige que job y mensaje estén
    los dos en fallo, para no pisar filas a medio camino.
    """
    stmt = (
        select(MessageOutbox.id, MessageOutbox.message_id, MessageOutbox.last_error)
        .join(WspMessage, WspMessage.id == MessageOutbox.message_id)
        .where(
            MessageOutbox.status == "failed",
            WspMessage.status == "FAILED",
            MessageOutbox.updated_at < cutoff,
        )
        .order_by(MessageOutbox.id.asc())
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    async with get_sessionmaker()() as session:
        return [tuple(row) for row in (await session.execute(stmt)).all()]


async def _apply(job_ids: list[int], message_ids: list[int]) -> tuple[int, int]:
    now = datetime.now(timezone.utc)
    async with get_sessionmaker()() as session:
        jobs = await session.execute(
            update(MessageOutbox)
            .where(MessageOutbox.id.in_(job_ids), MessageOutbox.status == "failed")
            .values(status="discarded", updated_at=now)
        )
        messages = await session.execute(
            update(WspMessage)
            .where(WspMessage.id.in_(message_ids), WspMessage.status == "FAILED")
            .values(status="DISCARDED")
        )
        # Una sola transacción: que no quede el job cerrado con la burbuja
        # todavía ofreciendo un reintento que ya no existe.
        await session.commit()
    return jobs.rowcount or 0, messages.rowcount or 0


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Marca como descartados los envíos fallidos viejos. Sin --apply solo simula.",
    )
    parser.add_argument("--apply", action="store_true", help="Escribe los cambios en PostgreSQL.")
    parser.add_argument(
        "--older-than-hours", type=int, default=DEFAULT_OLDER_THAN_HOURS,
        help=f"Solo fallos con más de estas horas (por defecto {DEFAULT_OLDER_THAN_HOURS}).",
    )
    parser.add_argument("--limit", type=int, help="Procesa como máximo esta cantidad de filas.")
    return parser


async def run(args: argparse.Namespace) -> int:
    if args.limit is not None and args.limit < 1:
        raise ValueError("--limit debe ser mayor que cero")
    if args.older_than_hours < 0:
        raise ValueError("--older-than-hours no puede ser negativo")

    cutoff = datetime.now(timezone.utc) - timedelta(hours=args.older_than_hours)
    rows = await _candidates(cutoff, args.limit)
    if not rows:
        print("failed=0 mode=noop")
        return 0

    causes = Counter((error or "(sin last_error)")[:ERROR_PREVIEW_CHARS] for _, _, error in rows)
    print(f"failed={len(rows)} older_than_hours={args.older_than_hours} "
          f"mode={'apply' if args.apply else 'dry-run'}")
    for cause, count in causes.most_common():
        print(f"  {count:>4}  {cause}")

    if not args.apply:
        print("database_updates=0; usa --apply para guardar los resultados")
        return 0

    jobs, messages = await _apply([job for job, _, _ in rows], [msg for _, msg, _ in rows])
    print(f"database_updates=jobs:{jobs},messages:{messages}")
    return 0


async def main() -> int:
    args = _parser().parse_args()
    try:
        return await run(args)
    finally:
        await close_engine()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
