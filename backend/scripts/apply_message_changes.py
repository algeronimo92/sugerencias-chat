"""Aplica las ediciones y borrados de WhatsApp que quedaron guardados como
mensajes sueltos.

Hasta que el webhook supo tratarlos, un ``edit`` o un ``revoke`` hecho desde
el celular se guardaba como un mensaje más del hilo ("Mensaje edit") y el
original quedaba intacto. Este script hace con esas filas lo mismo que hace
hoy el webhook: reescribe el texto del original o lo marca como eliminado, y
borra la fila suelta. Las que no encuentran su original (un mensaje anterior a
la integración) se borran igual: no son algo que alguien haya escrito.

Sin ``--apply`` solo muestra lo que haría.

Uso desde el contenedor del backend::

    python -m scripts.apply_message_changes --hostname dermicapro.cliniventas.com
    python -m scripts.apply_message_changes --hostname dermicapro.cliniventas.com --apply
"""

from __future__ import annotations

import argparse
import asyncio
from datetime import datetime, timezone

from sqlalchemy import delete, select, update

from app.db.models.conversations import WspMessage
from app.db.session import close_engine, get_sessionmaker
from app.integrations.meta_webhook.processor import MESSAGE_CHANGES, _original_message_id, _timestamp
from app.integrations.meta_webhook.projection import project
from app.tenancy.context import tenant_context
from app.tenancy.resolver import resolve_tenant_by_hostname


async def _loose_rows() -> list[WspMessage]:
    async with get_sessionmaker()() as session:
        return list((await session.execute(
            select(WspMessage)
            .where(WspMessage.message_type.in_(MESSAGE_CHANGES))
            # Las ediciones en orden: si hubo varias, queda la última.
            .order_by(WspMessage.sent_at, WspMessage.id)
        )).scalars())


async def _plan(row: WspMessage) -> tuple[int | None, dict]:
    """(id del original o None, valores a escribir en él)."""
    payload = row.provider_payload or {}
    change = payload.get(row.message_type) if isinstance(payload.get(row.message_type), dict) else {}
    original = change.get("original_message_id")
    if not isinstance(original, str):
        return None, {}
    target = await _original_message_id(row.chat_id, original)
    at = _timestamp(payload.get("timestamp")) or row.sent_at or datetime.now(timezone.utc)
    if row.message_type == "edit":
        edited = change.get("message") if isinstance(change.get("message"), dict) else {}
        return target, {"content": project(edited).content, "edited_at": at}
    return target, {"deleted_at": at, "pinned_at": None, "pinned_by_user_id": None}


async def _main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hostname", required=True, help="Dominio principal del negocio")
    parser.add_argument("--apply", action="store_true", help="Aplicar (sin esto solo muestra)")
    args = parser.parse_args()

    try:
        context = await resolve_tenant_by_hostname(args.hostname)
        if context is None:
            raise SystemExit(f"No hay un negocio activo con el dominio {args.hostname}")
        with tenant_context(context):
            rows = await _loose_rows()
            plans = [(row, *await _plan(row)) for row in rows]
            for row, target, values in plans:
                outcome = f"-> mensaje {target}" if target else "sin original, solo se borra"
                print(f"  {row.message_type:<6} fila {row.id} (chat {row.chat_id}) {outcome}")
            matched = sum(1 for _row, target, _values in plans if target)
            print(f"filas={len(plans)} con_original={matched} mode={'apply' if args.apply else 'dry-run'}")
            if not args.apply or not plans:
                if plans:
                    print("Nada se modificó: repetir con --apply.")
                return 0
            async with get_sessionmaker()() as session:
                for row, target, values in plans:
                    if target is not None:
                        await session.execute(update(WspMessage).where(WspMessage.id == target).values(**values))
                await session.execute(delete(WspMessage).where(WspMessage.id.in_([row.id for row, *_ in plans])))
                # Todo o nada: que no quede un original editado con su fila
                # suelta todavía en el hilo.
                await session.commit()
            print(f"Aplicados {matched} cambios; borradas {len(plans)} filas sueltas.")
        return 0
    finally:
        await close_engine()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
