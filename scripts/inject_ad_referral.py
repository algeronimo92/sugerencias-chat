#!/usr/bin/env python3
"""Inyecta la extracción del anuncio Click-to-WhatsApp en el workflow de n8n.

Cada nodo "* content" normaliza un tipo de mensaje entrante hacia la columna
``payload`` que termina en ``wsp_messages``. El evento de Evolution trae el anuncio
en ``externalAdReply`` (en distintas rutas según haya saludo automático), así que
este script mergea en el ``payload`` de cada nodo un ``ad_referral`` extraído con una
búsqueda profunda sobre el evento crudo, respetando la referencia al evento que ya
usa cada nodo (``$json.body`` o ``$('Switch Control type1')`` en las ramas de media).

Uso:
    python3 scripts/inject_ad_referral.py [entrada.json] [salida.json]

Por defecto lee ``docs/rag.json`` y escribe ``docs/rag-v2.json``. Es idempotente:
un nodo ya procesado (lleva el marcador ``/*ADREF*/``) se deja intacto.
"""

import json
import sys
import uuid
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
DEFAULT_IN = REPO / "docs" / "rag.json"
DEFAULT_OUT = REPO / "docs" / "rag-v2.json"

# Nodos que normalizan un mensaje entrante del cliente (donde aplica CTWA).
TARGET_NODES = [
    "text content",
    "image content",
    "video content",
    "audio content",
    "document content",
    "location content",
    "contact content",
    "poll content",
    "sticker content",
    "unsupported content",
]

MARKER = "/*ADREF*/"


def event_ref_for(node: dict) -> str:
    """Cómo referencia este nodo el evento crudo de Evolution."""
    values = " ".join(
        a.get("value", "")
        for a in node["parameters"]["assignments"]["assignments"]
    )
    if "Switch Control type1" in values and ".body" in values:
        return "($('Switch Control type1').item.json.body || {}).data || {}"
    return "($json.body || {}).data || {}"


def strip_expr(value: str) -> str:
    """Devuelve la expresión JS interna de un valor n8n ``={{ ... }}``."""
    v = value.strip()
    if v.startswith("={{") and v.endswith("}}"):
        return v[3:-2].strip()
    return "null"


def build_payload_value(base_inner: str, event_ref: str) -> str:
    ad = (
        "let ad = null; "
        "(function find(o){ if (!o || typeof o !== 'object' || ad) return; "
        "if (o.externalAdReply) { ad = o.externalAdReply; return; } "
        "for (const k in o) find(o[k]); })(" + event_ref + "); "
        "const adref = ad ? { ad_referral: { "
        "title: ad.title || null, body: ad.body || null, "
        "source_url: ad.sourceUrl || null, source_id: ad.sourceId || null, "
        "source_type: ad.sourceType || null, source_app: ad.sourceApp || null, "
        "media_type: ad.mediaType != null ? ad.mediaType : null, "
        "media_url: ad.mediaUrl || null, thumbnail_url: ad.thumbnailUrl || null, "
        "ctwa_clid: ad.ctwaClid || null } } : null; "
    )
    return (
        "={{ (() => { " + MARKER + " const base = (" + base_inner + "); " + ad
        + "if (base == null && adref == null) return null; "
        "return Object.assign({}, base || {}, adref || {}); })() }}"
    )


def process_node(node: dict) -> str:
    assignments = node["parameters"]["assignments"]["assignments"]
    payload = next((a for a in assignments if a.get("name") == "payload"), None)

    if payload and MARKER in payload.get("value", ""):
        return "skip (ya inyectado)"

    event_ref = event_ref_for(node)

    if payload is None:
        base_inner = "null"
        assignments.append(
            {
                "id": str(uuid.uuid4()),
                "name": "payload",
                "value": build_payload_value(base_inner, event_ref),
                "type": "object",
            }
        )
        return f"payload agregado (evento: {event_ref})"

    current = payload.get("value", "")
    if "externalAdReply" in current or "ad_referral" in current:
        # Extracción de anuncio previa (manual o rota): se regenera desde cero.
        base_inner = "null"
    else:
        base_inner = strip_expr(current)
    payload["value"] = build_payload_value(base_inner, event_ref)
    payload["type"] = "object"
    return f"payload mergeado (evento: {event_ref})"


def main() -> int:
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_IN
    dst = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUT

    workflow = json.loads(src.read_text())
    nodes = {n["name"]: n for n in workflow["nodes"]}

    for name in TARGET_NODES:
        node = nodes.get(name)
        if node is None:
            print(f"  - {name}: NO ENCONTRADO")
            continue
        print(f"  - {name}: {process_node(node)}")

    dst.write_text(json.dumps(workflow, ensure_ascii=False, indent=2))
    print(f"\nEscrito: {dst}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
