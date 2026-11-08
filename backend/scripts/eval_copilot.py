"""Corre los casos del copiloto contra las sugerencias nativas y los valida.

Los casos y el validador viven en el repo ``analisis-agentes-ia``
(``utils/tests-copiloto.json`` y ``utils/test_copiloto.py``): con ellos se
midió el copiloto de n8n (118/120 con gemini-2.5-flash en julio de 2026).
Este script arma el mismo pedido que ``NativeAiProvider.suggest`` —perfil,
catálogo, recursos y conocimiento del negocio real— pero con el lead y el
historial de cada caso, sin escribir nada en la base. Así se comparan los dos
copilotos con la misma vara.

Cada caso cuesta una llamada al proveedor con la clave del negocio.

Uso:
    python -m scripts.eval_copilot --source ../analisis-agentes-ia --host dermicapro.localhost
    python -m scripts.eval_copilot --source ... --host ... --only 1,5,12 --out /tmp/eval.json
"""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path


def load_validator(source: Path):
    """``test_copiloto`` lee sus casos y el catálogo público al importarse."""

    path = source / "utils" / "test_copiloto.py"
    spec = importlib.util.spec_from_file_location("analisis_test_copiloto", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def case_lead(case: dict, now: datetime) -> dict:
    lead = dict(case["lead"])
    lead["ultimo_mensaje_at"] = (now - timedelta(hours=case.get("antiguedad_horas", 1))).isoformat()
    return lead


def case_messages(case: dict, now: datetime) -> list[dict]:
    """Del más nuevo al más viejo, con la forma de ``fetch_analysis_context``."""

    history = case["historial"]
    messages = []
    for index, message in enumerate(history):
        sent_at = now - timedelta(hours=case.get("antiguedad_horas", 1), minutes=len(history) - index)
        messages.append({
            "sender": message["rol"], "content": message["texto"],
            "sent_at": sent_at.isoformat(), "message_type": "text",
        })
    return list(reversed(messages))


def case_resources(case: dict) -> list[dict]:
    return [
        {"id": item["id"], "nombre": item["id"], "tipo": item.get("funcion"), "descripcion": item.get("descripcion")}
        for item in case.get("recursos", [])
    ]


async def _run(args, validator) -> int:
    from app.db.session import close_engine
    from app.integrations.llm.base import LlmError, LlmRequest
    from app.integrations.llm.client import build_client
    from app.modules.ai.ai_assistant_service import fetch_tenant_config, list_ai_catalog
    from app.modules.ai.infrastructure.native_provider import (
        PROMPT_VERSION, SUGGESTION_SCHEMA, _generate_validated, _models_for_tenant,
        build_user_prompt, gather_knowledge, load_system_prompt,
    )
    from app.tenancy.resolver import resolve_tenant_by_hostname

    cases = validator.CASOS
    if args.only:
        wanted = {int(item) for item in args.only.split(",")}
        cases = [case for case in cases if case["id"] in wanted]

    results = []
    try:
        tenant = await resolve_tenant_by_hostname(args.host)
        if tenant is None:
            print(f"{args.host} no corresponde a ningún negocio", file=sys.stderr)
            return 2
        from app.tenancy.context import tenant_context

        with tenant_context(tenant):
            chain = await _models_for_tenant()
            if args.model:
                chain = [item for item in chain if item[0] == args.model] or chain
            if not chain:
                print("El negocio no tiene clave de IA", file=sys.stderr)
                return 2
            spec, api_key = chain[0]
            client = build_client(spec, api_key)
            tenant_config = await fetch_tenant_config()
            catalog = await list_ai_catalog()
            system = load_system_prompt()
            print(f"modelo {spec} · prompt {PROMPT_VERSION} · {len(cases)} casos\n")

            async def one(case: dict) -> dict:
                now = datetime.now(timezone.utc)
                lead, messages = case_lead(case, now), case_messages(case, now)
                instruction = case.get("indicacion_vendedor") or None
                knowledge = await gather_knowledge(lead, messages, instruction, catalog)
                request = LlmRequest(
                    system=system,
                    user=build_user_prompt(
                        tenant_config=tenant_config, lead=lead, messages=messages,
                        resources=case_resources(case), catalog=catalog, knowledge=knowledge,
                        instruction=instruction, now=now,
                    ),
                    schema=SUGGESTION_SCHEMA, schema_name="sugerencias_copiloto",
                )
                try:
                    suggestion, _result = await _generate_validated(client, request)
                    response = suggestion.model_dump()
                    failures, alert = validator.validar(case, response)
                except LlmError as exc:
                    response, failures, alert = None, [f"el modelo no respondió: {exc}"], None
                return {
                    "id": case["id"], "nombre": case["nombre"], "fallos": failures, "alerta": alert,
                    "conocimiento": [item["title"] for item in knowledge], "respuesta": response,
                }

            semaphore = asyncio.Semaphore(args.concurrency)

            async def bounded(case: dict) -> dict:
                async with semaphore:
                    return await one(case)

            results = await asyncio.gather(*(bounded(case) for case in cases))
    finally:
        await close_engine()

    for result in sorted(results, key=lambda item: item["id"]):
        validator.reportar({"id": result["id"], "nombre": result["nombre"]}, result["fallos"], result["alerta"])
    passed = sum(not result["fallos"] for result in results)
    print(f"\n=== {passed}/{len(results)} casos aprobados ===")
    if args.out:
        Path(args.out).write_text(json.dumps(results, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", required=True, type=Path, help="raíz del repo analisis-agentes-ia")
    parser.add_argument("--host", required=True, help="dominio del negocio cuyo perfil, catálogo y conocimiento se usan")
    parser.add_argument("--only", help="ids de casos separados por coma")
    parser.add_argument("--model", help="proveedor:modelo de la cadena del negocio a usar (por defecto el principal)")
    parser.add_argument("--concurrency", type=int, default=4)
    parser.add_argument("--out", help="guarda respuestas y fallos en este JSON")
    args = parser.parse_args()
    return asyncio.run(_run(args, load_validator(args.source)))


if __name__ == "__main__":
    raise SystemExit(main())
