"""Mide qué tan seguido el copiloto le pasa al modelo la ficha correcta.

Carga la biblioteca de plantillas (``scripts/knowledge_templates``) como
conocimiento de un negocio y, para cada caso de ``knowledge_eval_cases.json``
(lo que escribe un cliente y las fichas que deberían llegar), arma el contexto
como lo hace una sugerencia: solo por palabras y con búsqueda híbrida. Informa:

- acierto: alguna ficha esperada entró al contexto que recibe el modelo;
- posición: en qué lugar entró el primer fragmento esperado (1 = el primero);
- MRR: promedio de 1/posición (1,0 = siempre primero; 0 = nunca entró).

Todo corre dentro de una transacción que se revierte al final: no deja
documentos ni vectores en la base. Aun así, solo contra una base local.

Los embeddings usan ``OPENAI_API_KEY`` o ``GEMINI_API_KEY`` (unos centavos por
corrida). Sin servicio de interés: mide la búsqueda general, que es donde las
palabras del cliente y las de la ficha no coinciden.

Uso:
    DATABASE_URL=<local> SECRET_KEY=dev OPENAI_API_KEY=... \\
        python -m scripts.eval_knowledge_retrieval --schema tenant_xxx
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID

from sqlalchemy import delete, text

from app.core.config import settings
from app.db.models.ai import KnowledgeDocument
from app.db.uow import current_session, unit_of_work
from app.integrations.llm.embeddings import build_embedding_client
from app.modules.ai.infrastructure.native_provider import gather_knowledge
from app.modules.ai.knowledge_service import create_document
from app.tenancy.context import TenantContext, tenant_context
from scripts.seed_knowledge_templates import load_library

CASES = Path(__file__).resolve().parent / "knowledge_eval_cases.json"
KEY_ENV = {"openai": "OPENAI_API_KEY", "gemini": "GEMINI_API_KEY"}


# Modo → (con embeddings, siguiendo las fichas que nombra lo encontrado).
MODES = {
    "palabras": (False, False),
    "palabras+fichas": (False, True),
    "híbrida": (True, False),
    "híbrida+fichas": (True, True),
}


class _Rollback(Exception):
    pass


def _is_local(url: str) -> bool:
    host = (urlparse(url.replace("+asyncpg", "")).hostname or "").lower()
    return host in {"localhost", "127.0.0.1", "::1"} or host.endswith(".localhost") or "." not in host


def _messages(texts: list[str]) -> list[dict]:
    # Del más nuevo al más viejo, como los entrega el contexto del lead.
    return [{"sender": "cliente", "content": content} for content in reversed(texts)]


def _score(knowledge: list[dict], expected: list[str]) -> int | None:
    for position, chunk in enumerate(knowledge, start=1):
        if chunk["title"] in expected:
            return position
    return None


async def _evaluate(context: TenantContext, embedder, cases: list[dict]) -> list[dict]:
    results: list[dict] = []
    with tenant_context(context):
        try:
            async with unit_of_work():
                # Solo la biblioteca: lo que el negocio tenga cargado no cuenta
                # (y vuelve intacto con el rollback).
                await current_session().execute(delete(KnowledgeDocument))
                for template in load_library():
                    await create_document(template["title"], template["content"], template["document_type"])
                for case in cases:
                    messages = _messages(case["mensajes"])
                    result = {"case": " / ".join(case["mensajes"]), "error": None}
                    for mode, (mode_embedder, follow) in MODES.items():
                        knowledge, info = await gather_knowledge(
                            {}, messages, None, [], embedder if mode_embedder else None, follow_references=follow,
                        )
                        result[mode] = _score(knowledge, case["esperado"])
                        result["error"] = result["error"] or info.get("embedding_error")
                    results.append(result)
                raise _Rollback
        except _Rollback:
            pass
    return results


def _summary(results: list[dict], mode: str) -> str:
    positions = [result[mode] for result in results]
    hits = sum(1 for position in positions if position)
    mrr = sum(1 / position for position in positions if position) / len(positions)
    return f"{hits}/{len(positions)} aciertos ({hits / len(positions):.0%}) · MRR {mrr:.2f}"


async def _context(schema: str) -> TenantContext:
    from app.db.session import get_sessionmaker

    async with get_sessionmaker()() as session:
        organization_id = await session.scalar(
            text("SELECT id FROM public.organizations WHERE schema_name = :schema"), {"schema": schema}
        )
    if organization_id is None:
        raise SystemExit(f"No hay un negocio con el schema {schema}")
    return TenantContext(organization_id=UUID(str(organization_id)), schema_name=schema, hostname="eval.localhost")


async def _run(schema: str, embedder, cases: list[dict]) -> list[dict]:
    return await _evaluate(await _context(schema), embedder, cases)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--schema", required=True, help="schema del negocio local donde correr (no se modifica)")
    parser.add_argument("--provider", choices=sorted(KEY_ENV), default="openai")
    args = parser.parse_args()
    if not _is_local(settings.database_url):
        print("Solo contra una base local (DATABASE_URL).", file=sys.stderr)
        return 2
    key = os.environ.get(KEY_ENV[args.provider], "").strip()
    if not key:
        print(f"Falta {KEY_ENV[args.provider]}.", file=sys.stderr)
        return 2
    cases = json.loads(CASES.read_text(encoding="utf-8"))["casos"]
    embedder = build_embedding_client(args.provider, key)
    results = asyncio.run(_run(args.schema, embedder, cases))

    width = min(60, max(len(result["case"]) for result in results))
    print("caso".ljust(width) + "".join(f"  {mode:>15}" for mode in MODES))
    for result in results:
        print(result["case"][:width].ljust(width) + "".join(f"  {str(result[mode] or '—'):>15}" for mode in MODES))
    errors = {result["error"] for result in results if result["error"]}
    if errors:
        print(f"\nLa búsqueda por significado falló: {errors}", file=sys.stderr)
    print()
    for mode in MODES:
        print(f"{mode:<16} {_summary(results, mode)}")
    print(f"(embeddings: {embedder.spec})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
