"""Recupera ``wsp_messages.sender`` consultando ``key.fromMe`` en Evolution.

El modo por defecto es una simulación: consulta Evolution y muestra únicamente
conteos. PostgreSQL solo se modifica cuando se pasa ``--apply``.

Uso desde el contenedor del backend::

    python -m scripts.backfill_message_senders
    python -m scripts.backfill_message_senders --apply
"""

import argparse
import asyncio
from collections import Counter
from dataclasses import dataclass

import httpx
from sqlalchemy import select, update

from db.models import WspMessage
from db.session import close_engine, get_sessionmaker
from services.settings_service import get_effective_many

DEFAULT_CONCURRENCY = 5
MAX_CONCURRENCY = 20
MAX_ATTEMPTS = 3


@dataclass(frozen=True)
class PendingMessage:
    row_id: int
    wa_message_id: str


@dataclass(frozen=True)
class LookupResult:
    message: PendingMessage
    sender: str | None
    error: str | None = None


def _collect_directions(value: object, target_id: str) -> set[bool]:
    """Encuentra valores booleanos ``key.fromMe`` para un ID, sin asumir
    la forma exterior de la respuesta de las distintas versiones de Evolution.
    """
    directions: set[bool] = set()
    if isinstance(value, dict):
        key = value.get("key")
        if isinstance(key, dict) and str(key.get("id")) == target_id:
            from_me = key.get("fromMe")
            if isinstance(from_me, bool):
                directions.add(from_me)
        for child in value.values():
            directions.update(_collect_directions(child, target_id))
    elif isinstance(value, list):
        for child in value:
            directions.update(_collect_directions(child, target_id))
    return directions


def extract_sender(payload: object, target_id: str) -> str | None:
    """Traduce una coincidencia inequívoca de Evolution al dominio local."""
    directions = _collect_directions(payload, target_id)
    if directions == {True}:
        return "vendedor"
    if directions == {False}:
        return "cliente"
    return None


async def _pending_messages(
    *, chat_id: str | None, limit: int | None
) -> list[PendingMessage]:
    stmt = (
        select(WspMessage.id, WspMessage.wa_message_id)
        .where(
            WspMessage.sender.is_(None),
            WspMessage.wa_message_id.is_not(None),
        )
        .order_by(WspMessage.id.asc())
    )
    if chat_id:
        stmt = stmt.where(WspMessage.chat_id == chat_id)
    if limit is not None:
        stmt = stmt.limit(limit)

    async with get_sessionmaker()() as session:
        rows = (await session.execute(stmt)).all()
    return [
        PendingMessage(row_id=row_id, wa_message_id=wa_message_id)
        for row_id, wa_message_id in rows
    ]


async def _lookup_sender(
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
    endpoint: str,
    message: PendingMessage,
) -> LookupResult:
    payload = {"where": {"key": {"id": message.wa_message_id}}}
    async with semaphore:
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                response = await client.post(endpoint, json=payload)
            except httpx.HTTPError:
                if attempt == MAX_ATTEMPTS:
                    return LookupResult(message, None, "network_error")
                await asyncio.sleep(0.5 * attempt)
                continue

            if response.status_code == 429 or response.status_code >= 500:
                if attempt < MAX_ATTEMPTS:
                    await asyncio.sleep(0.5 * attempt)
                    continue
            if response.is_error:
                return LookupResult(message, None, f"http_{response.status_code}")

            try:
                response_payload = response.json()
            except ValueError:
                return LookupResult(message, None, "invalid_json")

            sender = extract_sender(response_payload, message.wa_message_id)
            if sender is None:
                return LookupResult(message, None, "not_found_or_ambiguous")
            return LookupResult(message, sender)

    return LookupResult(message, None, "unexpected_error")


async def _apply_results(results: list[LookupResult]) -> int:
    updated = 0
    async with get_sessionmaker()() as session:
        for result in results:
            if result.sender is None:
                continue
            statement = (
                update(WspMessage)
                .where(
                    WspMessage.id == result.message.row_id,
                    WspMessage.wa_message_id == result.message.wa_message_id,
                    WspMessage.sender.is_(None),
                )
                .values(sender=result.sender)
            )
            update_result = await session.execute(statement)
            updated += update_result.rowcount or 0
        await session.commit()
    return updated


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Recupera sender desde Evolution. Sin --apply solo simula y no "
            "modifica PostgreSQL."
        )
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actualiza exclusivamente las filas resueltas sin ambigüedad.",
    )
    parser.add_argument(
        "--chat-id",
        help="Limita la recuperación a un remoteJid concreto.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        help="Procesa como máximo esta cantidad de filas (útil para probar).",
    )
    parser.add_argument(
        "--concurrency",
        type=int,
        default=DEFAULT_CONCURRENCY,
        help=f"Consultas simultáneas a Evolution (1-{MAX_CONCURRENCY}).",
    )
    return parser


async def run(args: argparse.Namespace) -> int:
    if args.limit is not None and args.limit < 1:
        raise ValueError("--limit debe ser mayor que cero")
    if not 1 <= args.concurrency <= MAX_CONCURRENCY:
        raise ValueError(
            f"--concurrency debe estar entre 1 y {MAX_CONCURRENCY}"
        )

    pending = await _pending_messages(chat_id=args.chat_id, limit=args.limit)
    if not pending:
        print("pending=0 resolved=0 unresolved=0 mode=noop")
        return 0

    config = await get_effective_many((
        "evolution_api_url",
        "evolution_api_key",
        "evolution_instance",
    ))
    if not all(config.values()):
        raise RuntimeError(
            "Evolution API no está configurada (URL / API key / instancia)"
        )

    endpoint = (
        f"{config['evolution_api_url'].rstrip('/')}/chat/findMessages/"
        f"{config['evolution_instance']}"
    )
    semaphore = asyncio.Semaphore(args.concurrency)
    async with httpx.AsyncClient(
        headers={"apikey": config["evolution_api_key"]},
        timeout=30.0,
    ) as client:
        results = await asyncio.gather(*(
            _lookup_sender(client, semaphore, endpoint, message)
            for message in pending
        ))

    resolved = [result for result in results if result.sender is not None]
    sender_counts = Counter(result.sender for result in resolved)
    error_counts = Counter(
        result.error for result in results if result.error is not None
    )
    print(
        f"pending={len(pending)} resolved={len(resolved)} "
        f"cliente={sender_counts['cliente']} vendedor={sender_counts['vendedor']} "
        f"unresolved={len(pending) - len(resolved)} "
        f"mode={'apply' if args.apply else 'dry-run'}"
    )
    if error_counts:
        print(
            "unresolved_reasons="
            + ",".join(
                f"{reason}:{amount}"
                for reason, amount in sorted(error_counts.items())
            )
        )

    if not args.apply:
        print("database_updates=0; usa --apply para guardar los resultados")
        return 0

    updated = await _apply_results(resolved)
    print(f"database_updates={updated}")
    return 0


async def main() -> int:
    args = _parser().parse_args()
    try:
        return await run(args)
    finally:
        await close_engine()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
