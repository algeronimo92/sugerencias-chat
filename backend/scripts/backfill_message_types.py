"""Normaliza las filas viejas de ``wsp_messages`` al modelo de tipos.

Antes, ``content`` multiplexaba el tipo (pseudo-tags ``<image>…</image>``), el
caption y el análisis IA (``Analisis: …``). Este backfill parte esas filas en
las columnas nuevas: ``message_type`` (del tag), ``content`` limpio (solo el
caption), ``analysis`` (el bloque de IA, marcado ``version: 0`` = migrado, modelo
desconocido) y ``payload`` (lat/lon de ubicación, filename de documento, etc.).

Solo toca filas con ``message_type IS NULL`` (todavía sin normalizar). El modo por
defecto es simulación: muestra conteos y no modifica PostgreSQL. Se escribe solo
con ``--apply`` (hacer un dump antes; ver db/backups).

Uso desde el contenedor del backend::

    python -m scripts.backfill_message_types
    python -m scripts.backfill_message_types --apply
"""

import argparse
import asyncio
import json
import re
from collections import Counter
from dataclasses import dataclass

from sqlalchemy import select, update

from db.models import WspMessage
from db.session import close_engine, get_sessionmaker

# Mismo formato que escribía n8n y que el frontend parsea como respaldo legado.
_TAG_RE = re.compile(r"^<(\w+)>([\s\S]*)</\1>$")
# El bloque de análisis va tras el caption (precedido de saltos) o directamente
# al principio cuando el adjunto no tiene caption; de ahí el `^|\n`.
_ANALYSIS_RE = re.compile(r"(?:^|\n)\s*Analisis:\s*", re.IGNORECASE)

# tag legado -> message_type de la taxonomía nueva.
_TAG_TYPE = {
    "text": "text",
    "image": "image",
    "video": "video",
    "audio": "audio",
    "location": "location",
    "other": "document",
    "templateMessage": "template",
    "buttonsMessage": "interactive",
    "buttonsResponseMessage": "interactive",
}


@dataclass(frozen=True)
class Normalized:
    message_type: str
    content: str | None
    analysis: dict | None
    payload: dict | None


def _analysis(summary: str, kind: str) -> dict:
    return {"summary": summary, "kind": kind, "version": 0}


def parse_legacy_content(content: str | None) -> Normalized:
    """Traduce el ``content`` viejo a ``(message_type, content, analysis, payload)``.

    Función pura para poder testearla sin base. Refleja las mismas reglas que el
    respaldo legado del frontend (utils/message.ts)."""
    if not content:
        return Normalized("text", content, None, None)

    match = _TAG_RE.match(content)
    if not match:
        return Normalized("text", content, None, None)

    tag, inner = match.group(1), match.group(2)
    message_type = _TAG_TYPE.get(tag, "unsupported")
    inner_stripped = inner.strip()

    if message_type == "text":
        return Normalized("text", inner_stripped or None, None, None)

    if message_type in ("image", "video"):
        parts = _ANALYSIS_RE.split(inner_stripped, maxsplit=1)
        caption = parts[0].strip() or None
        summary = parts[1].strip() if len(parts) > 1 else ""
        analysis = _analysis(summary, "descripcion") if summary else None
        return Normalized(message_type, caption, analysis, None)

    if message_type == "audio":
        analysis = _analysis(inner_stripped, "transcripcion") if inner_stripped else None
        return Normalized("audio", None, analysis, None)

    if message_type == "location":
        coords = inner_stripped.split(",")
        try:
            lat, lon = float(coords[0]), float(coords[1])
        except (ValueError, IndexError):
            return Normalized("location", None, None, None)
        return Normalized("location", None, None, {"latitude": lat, "longitude": lon})

    if message_type == "document":
        return Normalized("document", None, None, {"filename": inner_stripped} if inner_stripped else None)

    if message_type in ("template", "interactive"):
        payload: dict | None
        try:
            parsed = json.loads(inner_stripped)
            payload = parsed if isinstance(parsed, dict) else {"raw": inner_stripped}
        except ValueError:
            payload = {"raw": inner_stripped} if inner_stripped else None
        text = None
        if isinstance(payload, dict):
            selected = payload.get("selectedDisplayText") or payload.get("title")
            text = selected if isinstance(selected, str) else None
        return Normalized(message_type, text, None, payload)

    return Normalized("unsupported", None, None, {"original_type": tag})


async def _pending(limit: int | None) -> list[tuple[int, str | None]]:
    stmt = (
        select(WspMessage.id, WspMessage.content)
        .where(WspMessage.message_type.is_(None))
        .order_by(WspMessage.id.asc())
    )
    if limit is not None:
        stmt = stmt.limit(limit)
    async with get_sessionmaker()() as session:
        return [(row_id, content) for row_id, content in (await session.execute(stmt)).all()]


async def _apply(rows: list[tuple[int, Normalized]]) -> int:
    updated = 0
    async with get_sessionmaker()() as session:
        for row_id, norm in rows:
            result = await session.execute(
                update(WspMessage)
                .where(WspMessage.id == row_id, WspMessage.message_type.is_(None))
                .values(
                    message_type=norm.message_type,
                    content=norm.content,
                    analysis=norm.analysis,
                    payload=norm.payload,
                )
            )
            updated += result.rowcount or 0
        await session.commit()
    return updated


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Normaliza wsp_messages al modelo de tipos. Sin --apply solo simula.",
    )
    parser.add_argument("--apply", action="store_true", help="Escribe los cambios en PostgreSQL.")
    parser.add_argument("--limit", type=int, help="Procesa como máximo esta cantidad de filas.")
    return parser


async def run(args: argparse.Namespace) -> int:
    if args.limit is not None and args.limit < 1:
        raise ValueError("--limit debe ser mayor que cero")

    pending = await _pending(args.limit)
    if not pending:
        print("pending=0 mode=noop")
        return 0

    rows = [(row_id, parse_legacy_content(content)) for row_id, content in pending]
    type_counts = Counter(norm.message_type for _, norm in rows)
    with_analysis = sum(1 for _, norm in rows if norm.analysis is not None)

    print(
        f"pending={len(rows)} with_analysis={with_analysis} "
        f"mode={'apply' if args.apply else 'dry-run'}"
    )
    print("por_tipo=" + ",".join(f"{t}:{n}" for t, n in sorted(type_counts.items())))

    if not args.apply:
        print("database_updates=0; usa --apply para guardar los resultados")
        return 0

    updated = await _apply(rows)
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
