"""Encuentra y fusiona las conversaciones partidas en dos leads por el LID.

Con el direccionamiento por LID de WhatsApp, los mensajes entrantes llegan solo
con un ``@lid``: crean un lead provisional, sin teléfono y con el pushName del
cliente como nombre. Los salientes van al JID telefónico y usan otro lead. La
misma persona queda en dos fichas, y la que el vendedor mira suele ser la que
no tiene el historial.

``learn_send_aliases`` corta la generación de pares nuevos, pero los que ya
existen hay que unirlos a mano. Este script los detecta y los fusiona.

Cómo se descubre el par: los mensajes que la app envió llevan en su ``key`` el
LID del chat junto al teléfono en ``remoteJidAlt`` —Baileys resuelve la
equivalencia al enviar—. Buscando ese campo en el historial del LID se obtiene
el teléfono, y con el teléfono, el lead que le corresponde. Los huérfanos a los
que nunca se les escribió no traen esa pista y quedan sin pareja: aparecen en
el listado como ``sin teléfono conocido``.

El modo por defecto solo lista. La fusión simula salvo que se pase ``--apply``.

Uso desde el contenedor del backend::

    python -m scripts.merge_lid_duplicates
    python -m scripts.merge_lid_duplicates --fusionar --todos
    python -m scripts.merge_lid_duplicates --fusionar --todos --apply
    python -m scripts.merge_lid_duplicates --fusionar --source <uuid> --target <uuid> --apply
"""

import argparse
import asyncio
from dataclasses import dataclass

import httpx
from sqlalchemy import func, select

from db.models import Lead, WhatsAppIdentity, WspMessage
from db.session import close_engine, get_sessionmaker
from services.lead_merge import LeadMergeError, merge_leads
from services.settings_service import get_effective_many
from services.whatsapp_identity_service import PHONE_SUFFIX

DEFAULT_CONCURRENCY = 5
# Una página alcanza: si la app le escribió al chat alguna vez, hay salientes
# recientes, y son los únicos que traen remoteJidAlt.
LOOKUP_PAGE_SIZE = 50


@dataclass(frozen=True)
class Orphan:
    lead_id: str
    nombre: str | None
    lid_jid: str
    mensajes: int


@dataclass(frozen=True)
class Candidate:
    orphan: Orphan
    phone_jid: str | None
    target_id: str | None
    target_phone: str | None
    target_messages: int = 0


async def _orphans() -> list[Orphan]:
    """Leads cuyo único alias es un LID: los que tienen la conversación."""
    mensajes = (
        select(WspMessage.chat_id, func.count().label("total"))
        .group_by(WspMessage.chat_id)
        .subquery()
    )
    tiene_telefono = (
        select(WhatsAppIdentity.lead_id)
        .where(WhatsAppIdentity.kind == "phone")
        .subquery()
    )
    stmt = (
        select(Lead.id, Lead.nombre, WhatsAppIdentity.jid, func.coalesce(mensajes.c.total, 0))
        .join(WhatsAppIdentity, WhatsAppIdentity.lead_id == Lead.id)
        .outerjoin(mensajes, mensajes.c.chat_id == Lead.id)
        .where(
            WhatsAppIdentity.kind == "lid",
            Lead.id.not_in(select(tiene_telefono.c.lead_id)),
        )
        .order_by(func.coalesce(mensajes.c.total, 0).desc())
    )
    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).all()
    return [Orphan(lead_id, nombre, jid, total) for lead_id, nombre, jid, total in rows]


async def _lead_for_phone(phone_jid: str) -> tuple[str | None, str | None, int]:
    """Lead dueño de ese JID telefónico, con su teléfono y cuántos mensajes tiene."""
    async with get_sessionmaker()() as session:
        lead_id = await session.scalar(
            select(WhatsAppIdentity.lead_id).where(WhatsAppIdentity.jid == phone_jid).limit(1)
        )
        if lead_id is None:
            return None, None, 0
        telefono = await session.scalar(select(Lead.telefono).where(Lead.id == lead_id))
        total = await session.scalar(
            select(func.count()).where(WspMessage.chat_id == lead_id)
        )
    return lead_id, telefono, total or 0


def _phone_from_records(payload: object) -> str | None:
    """Primer ``remoteJidAlt`` telefónico que aparezca en las keys del historial."""
    if isinstance(payload, dict):
        node = payload.get("messages", payload)
        records = node.get("records") if isinstance(node, dict) else node
    else:
        records = payload
    if not isinstance(records, list):
        return None
    for record in records:
        if not isinstance(record, dict):
            continue
        key = record.get("key")
        alt = key.get("remoteJidAlt") if isinstance(key, dict) else None
        if isinstance(alt, str) and alt.endswith(PHONE_SUFFIX):
            return alt.lower()
    return None


async def _lookup_phone(
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    endpoint: str,
    lid_jid: str,
) -> str | None:
    async with semaphore:
        try:
            response = await client.post(
                endpoint,
                json={
                    "where": {"key": {"remoteJid": lid_jid}},
                    "page": 1,
                    "offset": LOOKUP_PAGE_SIZE,
                },
            )
        except httpx.HTTPError:
            return None
    if response.is_error:
        return None
    try:
        return _phone_from_records(response.json())
    except ValueError:
        return None


async def _candidates(orphans: list[Orphan], concurrency: int) -> list[Candidate]:
    config = await get_effective_many((
        "evolution_api_url",
        "evolution_api_key",
        "evolution_instance",
    ))
    if not all(config.values()):
        raise RuntimeError("Evolution API no está configurada (URL / API key / instancia)")
    endpoint = (
        f"{config['evolution_api_url'].rstrip('/')}/chat/findMessages/"
        f"{config['evolution_instance']}"
    )
    semaphore = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient(
        headers={"apikey": config["evolution_api_key"]}, timeout=30.0
    ) as client:
        phones = await asyncio.gather(*(
            _lookup_phone(client, semaphore, endpoint, orphan.lid_jid)
            for orphan in orphans
        ))

    candidates: list[Candidate] = []
    for orphan, phone_jid in zip(orphans, phones):
        target_id, target_phone, target_messages = (
            await _lead_for_phone(phone_jid) if phone_jid else (None, None, 0)
        )
        candidates.append(
            Candidate(orphan, phone_jid, target_id, target_phone, target_messages)
        )
    return candidates


def _print_listado(candidates: list[Candidate]) -> None:
    emparejados = [c for c in candidates if c.target_id]
    sin_par = [c for c in candidates if not c.target_id]

    print(f"huerfanos={len(candidates)} emparejados={len(emparejados)} sin_par={len(sin_par)}")
    if emparejados:
        print("\nPares detectados (origen -> destino):")
        for c in emparejados:
            print(
                f"  {c.orphan.lead_id} ({c.orphan.nombre or 'sin nombre'}, "
                f"{c.orphan.mensajes} msgs, {c.orphan.lid_jid})"
            )
            print(
                f"    -> {c.target_id} ({c.target_phone}, {c.target_messages} msgs)"
            )
    if sin_par:
        print("\nSin teléfono conocido (nunca se les escribió desde la app):")
        for c in sin_par:
            estado = "sin lead telefónico" if c.phone_jid else "sin remoteJidAlt en Evolution"
            print(
                f"  {c.orphan.lead_id} ({c.orphan.nombre or 'sin nombre'}, "
                f"{c.orphan.mensajes} msgs) — {estado}"
            )


async def run(args: argparse.Namespace) -> int:
    if args.fusionar and args.source and args.target:
        report = await merge_leads(args.source, args.target, apply=args.apply)
        print(report.summary())
        return 0

    if args.fusionar and not args.todos:
        raise ValueError("Para fusionar indicá --source y --target, o bien --todos")

    orphans = await _orphans()
    if not orphans:
        print("huerfanos=0")
        return 0

    candidates = await _candidates(orphans, args.concurrency)

    if not args.fusionar:
        _print_listado(candidates)
        print(
            "\nPara fusionarlos: --fusionar --todos "
            "(agregá --apply para escribir de verdad)"
        )
        return 0

    fusionados = 0
    fallidos = 0
    for candidate in candidates:
        if not candidate.target_id:
            continue
        try:
            report = await merge_leads(
                candidate.orphan.lead_id, candidate.target_id, apply=args.apply
            )
        except LeadMergeError as exc:
            fallidos += 1
            print(f"  ERROR {candidate.orphan.lead_id}: {exc}")
            continue
        fusionados += 1
        print(f"  {report.summary()}")
    print(
        f"fusionados={fusionados} fallidos={fallidos} "
        f"mode={'apply' if args.apply else 'dry-run'}"
    )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--fusionar", action="store_true", help="Fusiona en vez de solo listar"
    )
    parser.add_argument("--source", help="Lead de origen (el del LID, con el historial)")
    parser.add_argument("--target", help="Lead de destino (el del teléfono)")
    parser.add_argument(
        "--todos", action="store_true", help="Fusiona todos los pares detectados"
    )
    parser.add_argument(
        "--apply", action="store_true", help="Escribe en la base; sin esto solo simula"
    )
    parser.add_argument(
        "--concurrency", type=int, default=DEFAULT_CONCURRENCY,
        help=f"Consultas simultáneas a Evolution (por defecto {DEFAULT_CONCURRENCY})",
    )
    return parser


async def _run_and_close(args: argparse.Namespace) -> int:
    # El engine se crea perezosamente dentro de run() y sus conexiones quedan
    # atadas al event loop de ese asyncio.run(): cerrarlo en un asyncio.run()
    # separado deja el pool intentando cerrar conexiones de un loop ya
    # destruido (RuntimeError: Event loop is closed). Un único run cubre todo.
    try:
        return await run(args)
    finally:
        await close_engine()


def main() -> int:
    args = build_parser().parse_args()
    if args.source and not args.source.strip():
        raise ValueError("--source vacío")
    return asyncio.run(_run_and_close(args))


if __name__ == "__main__":
    raise SystemExit(main())
