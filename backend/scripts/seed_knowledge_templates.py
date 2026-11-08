"""Carga en la biblioteca de la plataforma las plantillas de conocimiento que
nacieron en el repo ``analisis-agentes-ia``.

Esos documentos alimentaban el índice vectorial de n8n (Supabase ``documents``,
generado con ``utils/generar_chunks_rag.py``). Cuando el nodo RAG1 pasó a
consultar ``/api/webhooks/rag-search`` (septiembre 2026) el índice dejó de
leerse y su contenido no se migró: este script lo trae de vuelta, ahora como
plantillas que cada negocio importa y edita como suyas.

Las mismas cuatro fuentes y los mismos cortes que el generador original:
  - negocio/fichas-procedimientos.md  → una plantilla por procedimiento (tipo ficha)
  - negocio/mapa-dolores-soluciones.md → una plantilla (tipo faq; un fragmento por dolor)
  - guias/playbook-objeciones.md       → una plantilla (tipo guion; uno por objeción)
  - negocio/guiones-whatsapp.md        → una plantilla (tipo guion; uno por etapa)

Precios, ``operacion.md`` y ``expertos/`` quedan fuera a propósito (ver
``prompts/arquitectura-rag.md`` de ese repo): el precio sale del catálogo.

Idempotente por título: re-correrlo actualiza el contenido (y sube la versión
solo si cambió). Las copias que los negocios ya importaron no se tocan.

Uso (dry-run salvo --apply):
    python -m scripts.seed_knowledge_templates --source ../analisis-agentes-ia
    python -m scripts.seed_knowledge_templates --source ../analisis-agentes-ia --apply
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
from pathlib import Path

FICHAS = "negocio/fichas-procedimientos.md"
WHOLE_DOCUMENTS = (
    ("negocio/mapa-dolores-soluciones.md", "Mapa dolor → solución", "faq"),
    ("guias/playbook-objeciones.md", "Playbook de objeciones", "guion"),
    ("negocio/guiones-whatsapp.md", "Guiones de WhatsApp por etapa del funnel", "guion"),
)
# Secciones de las fichas que son notas para el equipo, no un procedimiento.
SKIPPED_FICHAS = ("uso en ventas",)
# Cuando el nombre de la ficha no se parece al del catálogo, el diálogo de
# importación no sabría a qué servicio vincularla.
SERVICE_HINTS = {
    "Borrado de Cejas · Borrado de Tatuajes": "Borrado de Tatuajes",
    "Remoción de Lunares o Acrocordones": "Remoción de Lunares",
}
# El nombre del negocio de origen no puede viajar en una plantilla de plataforma:
# queda como marcador, igual que [NOMBRE] o [ZONA] en los guiones.
SOURCE_BUSINESS = re.compile(r"\bDermicaPro\b")
BUSINESS_PLACEHOLDER = "[NEGOCIO]"

_LINK_RE = re.compile(r"\[\[([^\]|]+)(?:\|([^\]]+))?\]\]")
_EDITORIAL_RE = re.compile(r"\s*\**\[(?:VALIDAR|COMPLETAR|CONFIRMAR|DEFINIR)[^\]]*\]\**")
_SEPARATOR_RE = re.compile(r"^\s*-{3,}\s*$", re.MULTILINE)
_H1_RE = re.compile(r"\A\s*# [^\n]*\n")
_H2_RE = re.compile(r"^## (?!#)(.+)$", re.MULTILINE)


def clean(text: str) -> str:
    """Quita la navegación del vault y las notas editoriales internas."""

    text = _LINK_RE.sub(lambda match: match.group(2) or match.group(1), text)
    text = _EDITORIAL_RE.sub("", text)
    text = _SEPARATOR_RE.sub("", text)
    text = SOURCE_BUSINESS.sub(BUSINESS_PLACEHOLDER, text)
    text = re.sub(r"[ \t]+\n", "\n", text)
    return re.sub(r"\n{3,}", "\n\n", text).strip()


def procedure_name(heading: str) -> str:
    return heading.split(" (", 1)[0].strip()


def service_hint(heading: str) -> str:
    name = procedure_name(heading)
    return SERVICE_HINTS.get(name, name)


def ficha_templates(markdown: str) -> list[dict]:
    templates = []
    matches = list(_H2_RE.finditer(markdown))
    for index, match in enumerate(matches):
        heading = match.group(1).strip()
        if heading.lower().startswith(SKIPPED_FICHAS):
            continue
        end = matches[index + 1].start() if index + 1 < len(matches) else len(markdown)
        # El encabezado se queda en el contenido: el fragmento lleva el nombre
        # del procedimiento y se entiende solo.
        content = clean(markdown[match.start():end])
        templates.append({
            "title": f"Ficha: {procedure_name(heading)}",
            "document_type": "ficha",
            "service_hint": service_hint(heading),
            "content": content,
            "is_active": True,
        })
    return templates


def build_templates(source: Path) -> list[dict]:
    templates = ficha_templates((source / FICHAS).read_text(encoding="utf-8"))
    for path, title, document_type in WHOLE_DOCUMENTS:
        markdown = (source / path).read_text(encoding="utf-8")
        templates.append({
            "title": title,
            "document_type": document_type,
            "service_hint": None,
            "content": clean(_H1_RE.sub("", markdown, count=1)),
            "is_active": True,
        })
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
            # No reactiva una plantilla que el operador ocultó a mano.
            values = {key: value for key, value in template.items() if key != "is_active"}
            saved = await update_template(current["id"], values)
            changed = saved["version"] != current["version"]
            report.append({"title": saved["title"], "estado": "actualizada" if changed else "sin cambios", "version": saved["version"]})
        return report
    finally:
        await close_engine()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", required=True, type=Path, help="raíz del repo analisis-agentes-ia")
    parser.add_argument("--apply", action="store_true", help="escribe en la base; sin esto solo muestra el plan")
    args = parser.parse_args()

    templates = build_templates(args.source)
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
