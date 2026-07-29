"""Convierte las filas legadas de reacción al nuevo modelo de badge.

Antes una reacción de WhatsApp entraba como un mensaje propio
(``message_type='reaction'``, el emoji en ``content``, el id del reaccionado en
``payload.target_wa_message_id``). Ahora la reacción vive en la columna
``reactions`` del mensaje objetivo (badge estilo WhatsApp). Este backfill mueve
cada fila de reacción a su objetivo (con la misma lógica de merge que usan el
webhook y el envío) y borra la fila.

El modo por defecto es simulación: muestra conteos y no modifica PostgreSQL. Se
escribe solo con ``--apply`` (hacer un dump antes; ver db/backups).

Uso desde el contenedor del backend::

    python -m scripts.backfill_reactions
    python -m scripts.backfill_reactions --apply
"""

import argparse
import asyncio
from dataclasses import dataclass

from sqlalchemy import delete, select

from db.models import WspMessage
from db.session import close_engine, get_sessionmaker
from services.db_service import set_message_reaction


@dataclass(frozen=True)
class LegacyReaction:
    id: int
    chat_id: str
    emoji: str
    target_wa_message_id: str | None
    from_me: bool


async def _pending() -> list[LegacyReaction]:
    stmt = (
        select(
            WspMessage.id,
            WspMessage.chat_id,
            WspMessage.content,
            WspMessage.payload,
            WspMessage.sender,
        )
        .where(WspMessage.message_type == "reaction")
        .order_by(WspMessage.id.asc())
    )
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).all()
    return [
        LegacyReaction(
            id=row_id,
            chat_id=chat_id,
            emoji=(content or "").strip(),
            target_wa_message_id=(payload or {}).get("target_wa_message_id"),
            from_me=sender == "vendedor",
        )
        for row_id, chat_id, content, payload, sender in rows
    ]


async def _apply(rows: list[LegacyReaction]) -> tuple[int, int]:
    """Mergea cada reacción sobre su objetivo y borra la fila legada. Devuelve
    (badges aplicados, filas borradas). Las reacciones cuyo objetivo no está en
    la base igual se borran: son ruido legado que no se muestra en ningún lado."""
    merged = 0
    for r in rows:
        if r.target_wa_message_id and r.emoji:
            result = await set_message_reaction(
                r.chat_id, r.target_wa_message_id, r.emoji, r.from_me
            )
            if result is not None:
                merged += 1

    ids = [r.id for r in rows]
    async with get_sessionmaker()() as session:
        deleted = (await session.execute(
            delete(WspMessage).where(WspMessage.id.in_(ids))
        )).rowcount or 0
        await session.commit()
    return merged, deleted


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Mueve las reacciones legadas a la columna reactions. Sin --apply solo simula.",
    )
    parser.add_argument("--apply", action="store_true", help="Escribe los cambios en PostgreSQL.")
    return parser


async def run(args: argparse.Namespace) -> int:
    pending = await _pending()
    if not pending:
        print("pending=0 mode=noop")
        return 0

    resolvable = sum(1 for r in pending if r.target_wa_message_id and r.emoji)
    print(
        f"pending={len(pending)} con_objetivo_y_emoji={resolvable} "
        f"mode={'apply' if args.apply else 'dry-run'}"
    )

    if not args.apply:
        print("database_updates=0; usa --apply para guardar los resultados")
        return 0

    merged, deleted = await _apply(pending)
    print(f"badges_aplicados={merged} filas_borradas={deleted}")
    return 0


async def main() -> int:
    args = _parser().parse_args()
    try:
        return await run(args)
    finally:
        await close_engine()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
