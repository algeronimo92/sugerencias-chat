"""Carga en la biblioteca de la plataforma las plantillas de conocimiento de
``scripts/knowledge_templates/``.

Son las fichas de procedimientos, el mapa dolor → solución, el playbook de
objeciones y los guiones de WhatsApp con los que se armaba el índice vectorial
de n8n. Ese índice dejó de consultarse en septiembre de 2026 (RAG1 pasó a
``/api/webhooks/rag-search``) sin que su contenido se migrara; ahora vive acá,
como plantillas que cada negocio importa y edita como suyas.

Cada archivo es markdown con una cabecera mínima:

    ---
    title: Ficha: HIFU 12D
    document_type: ficha
    service_hint: HIFU 12D
    ---

La primera carga la hace la migración ``b7d2f4a8c913`` al desplegar (solo las
que faltan). Este script sirve para publicar cambios de contenido después:
es idempotente por título, actualiza el contenido (la versión sube solo si
cambió) y no reactiva una plantilla que el operador ocultó. Las copias que los
negocios ya importaron no se tocan.

Uso (dry-run salvo --apply):
    python -m scripts.seed_knowledge_templates
    python -m scripts.seed_knowledge_templates --apply
"""

from __future__ import annotations

import argparse
import asyncio
import json
from pathlib import Path

LIBRARY = Path(__file__).resolve().parent / "knowledge_templates"
_FIELDS = ("title", "document_type", "service_hint")


def parse_template(text: str) -> dict:
    if not text.startswith("---\n"):
        raise ValueError("falta la cabecera ---")
    header, separator, body = text[4:].partition("\n---\n")
    if not separator:
        raise ValueError("la cabecera no se cierra con ---")
    values: dict = dict.fromkeys(_FIELDS)
    for line in header.splitlines():
        key, colon, value = line.partition(":")
        if not colon or key.strip() not in _FIELDS:
            raise ValueError(f"línea de cabecera inválida: {line!r}")
        values[key.strip()] = value.strip() or None
    if not values["title"]:
        raise ValueError("falta title")
    return {**values, "content": body.strip(), "is_active": True}


def load_library(directory: Path = LIBRARY) -> list[dict]:
    templates = []
    for path in sorted(directory.glob("*.md")):
        try:
            templates.append(parse_template(path.read_text(encoding="utf-8")))
        except ValueError as exc:
            raise ValueError(f"{path.name}: {exc}") from exc
    return templates


async def _apply(templates: list[dict]) -> list[dict]:
    from app.db.session import close_engine
    from app.modules.platform.knowledge_templates import create_template, list_templates, update_template

    try:
        existing = {item["title"]: item for item in await list_templates(include_inactive=True)}
        report = []
        for template in templates:
            current = existing.get(template["title"])
            if current is None:
                saved = await create_template(template)
                report.append({"title": saved["title"], "estado": "creada", "version": saved["version"]})
                continue
            values = {key: value for key, value in template.items() if key != "is_active"}
            saved = await update_template(current["id"], values)
            changed = saved["version"] != current["version"]
            report.append({"title": saved["title"], "estado": "actualizada" if changed else "sin cambios", "version": saved["version"]})
        return report
    finally:
        await close_engine()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--apply", action="store_true", help="escribe en la base; sin esto solo muestra el plan")
    args = parser.parse_args()

    templates = load_library()
    if not args.apply:
        for template in templates:
            print(json.dumps({
                "title": template["title"], "tipo": template["document_type"],
                "servicio": template["service_hint"], "caracteres": len(template["content"]),
            }, ensure_ascii=False))
        print(f"dry-run: {len(templates)} plantillas; usa --apply para cargarlas")
        return 0
    for line in asyncio.run(_apply(templates)):
        print(json.dumps(line, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
