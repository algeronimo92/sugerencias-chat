"""Pasa los contactos de WhatsApp de un número del negocio a otro.

La lista de chats solo muestra los leads que tienen un identificador visto en
el número activo (``chat_queries._visible_lead_condition``). Ese "número" es
el ``phone_number_id`` de Meta, no el teléfono: si la misma línea se vuelve a
dar de alta, Meta le asigna un id nuevo y todos los chats anteriores dejan de
listarse, aunque los leads y los mensajes sigan en la base.

Pasó con DermicaPro el 20-11-2026: se borró la cuenta de WhatsApp del celular,
Meta eliminó la cuenta de WhatsApp Business de los chats y el mismo teléfono
volvió a aparecer con otro ``phone_number_id``.

Solo cambia ``whatsapp_identities.phone_number_id``. No toca leads ni
mensajes, ni los alias ``'*'`` de los leads creados a mano (ya se ven con
cualquier número). No hace falta para conectar un número *distinto*: ahí que
los chats del anterior no se listen es lo esperado.

Sin ``--apply`` solo muestra lo que haría. El destino por defecto es el número
conectado ahora, así que se corre después de volver a vincular.

Uso desde el contenedor del backend::

    python -m scripts.move_whatsapp_identities --hostname dermicapro.cliniventas.com --from-number-id <id viejo>
    python -m scripts.move_whatsapp_identities --hostname dermicapro.cliniventas.com --from-number-id <id viejo> --apply
"""

from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import func, select, update

from app.db.models.leads import WhatsAppIdentity
from app.db.session import close_engine, get_sessionmaker
from app.integrations.whatsapp.connection import ANY_CONNECTION, active_connection
from app.tenancy.context import tenant_context
from app.tenancy.resolver import resolve_tenant_by_hostname


async def identities_by_number() -> dict[str, tuple[int, int]]:
    """``phone_number_id`` -> (identificadores, leads distintos)."""
    async with get_sessionmaker()() as session:
        rows = (await session.execute(
            select(
                WhatsAppIdentity.phone_number_id,
                func.count(WhatsAppIdentity.id),
                func.count(func.distinct(WhatsAppIdentity.lead_id)),
            ).group_by(WhatsAppIdentity.phone_number_id)
        )).all()
    return {number: (identities, leads) for number, identities, leads in rows}


async def move_identities(source: str, target: str) -> int:
    """Cuántos identificadores pasaron de ``source`` a ``target``."""
    check_move(source, target)
    async with get_sessionmaker()() as session:
        result = await session.execute(
            update(WhatsAppIdentity)
            .where(WhatsAppIdentity.phone_number_id == source)
            .values(phone_number_id=target, updated_at=func.now())
        )
        await session.commit()
    return result.rowcount


def check_move(source: str, target: str) -> None:
    if not source or not target:
        raise ValueError("Faltan el número de origen o el de destino")
    if ANY_CONNECTION in (source, target):
        # Los '*' son leads creados a mano que esperan su primer evento de
        # Meta: moverlos los ataría a un número por el que nunca escribieron.
        raise ValueError(f"'{ANY_CONNECTION}' no es un número: esos contactos ya se ven con cualquiera")
    if source == target:
        raise ValueError("El origen y el destino son el mismo número")


async def _main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hostname", required=True, help="Dominio principal del negocio")
    parser.add_argument("--from-number-id", required=True, help="phone_number_id de Meta que dejó de existir")
    parser.add_argument("--to-number-id", help="por defecto, el número conectado ahora")
    parser.add_argument("--apply", action="store_true", help="Aplicar (sin esto solo muestra)")
    args = parser.parse_args()

    try:
        context = await resolve_tenant_by_hostname(args.hostname)
        if context is None:
            raise SystemExit(f"No hay un negocio activo con el dominio {args.hostname}")
        with tenant_context(context):
            active = await active_connection()
            source = args.from_number_id.strip()
            target = (args.to_number_id or active).strip()
            try:
                check_move(source, target)
            except ValueError as exc:
                raise SystemExit(str(exc))

            counts = await identities_by_number()
            for number, (identities, leads) in sorted(counts.items()):
                marks = [label for label, value in (("origen", source), ("destino", target), ("activo", active)) if number == value]
                print(f"  {number:<20} identificadores={identities:<7} leads={leads:<7} {' '.join(marks)}")
            identities, leads = counts.get(source, (0, 0))
            print(f"a_mover={identities} leads={leads} destino={target} mode={'apply' if args.apply else 'dry-run'}")
            if target != active:
                # Se puede preparar antes de reconectar, pero hasta entonces
                # los chats movidos tampoco se listan.
                print(f"Aviso: el destino no es el número activo ({active or 'ninguno'}).")
            if not identities:
                print("No hay contactos en el número de origen: nada que mover.")
                return 0
            if not args.apply:
                print("Nada se modificó: repetir con --apply.")
                return 0
            moved = await move_identities(source, target)
            print(f"Movidos {moved} identificadores a {target}.")
        return 0
    finally:
        await close_engine()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
