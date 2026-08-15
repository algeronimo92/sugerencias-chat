#!/usr/bin/env python3
"""Hace que el nodo `contact content` guarde el teléfono del contacto.

El nodo mapeaba solo `displayName`, así que un contacto compartido llegaba al
CRM sin número y la tarjeta del chat no podía ofrecer escribirle. El número no
viaja suelto en el evento de Evolution: hay que sacarlo del `vcard`,
prefiriendo el `waid` (formato internacional, es el JID sin dominio) sobre el
valor visible del `TEL`, que suele venir local y agrupado ("item1.TEL", que es
como lo manda WhatsApp desde Android).

Del vCard se guarda solo el nombre y el teléfono, nunca el texto crudo: trae la
foto del contacto en base64 y se replicaría en cada fila de `wsp_messages`.

Reescribe únicamente el `base` del payload y conserva el `ad_referral` que
inyecta `inject_ad_referral.py`. Es idempotente: si el nodo ya extrae el
teléfono, no toca nada.

Uso:
    python3 scripts/add_contact_phone_support.py "rag.json"
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from inject_ad_referral import build_payload_value, event_ref_for  # noqa: E402

NODE = "contact content"

# Un IIFE porque `build_payload_value` inserta esto como una sola expresión.
# Las llaves van separadas a propósito: dos `}` seguidas cerrarían la expresión
# de n8n antes de tiempo.
CONTACTS_BASE = (
    "(() => {{ "
    "const m = (({event}).message || {{}}); "
    "const tel = (v) => {{ "
    "const w = v.match(/waid=(\\d+)/i); if (w) return w[1]; "
    "const t = v.match(/^(?:[A-Za-z0-9-]+\\.)?TEL[^:\\r\\n]*:(.*)$/im); "
    "return t ? t[1].trim() : null; }}; "
    "const one = (c) => ({{ fullName: c.displayName || 'sin nombre', "
    "phoneNumber: tel(c.vcard || '') }}); "
    "return m.contactsArrayMessage "
    "? {{ contacts: (m.contactsArrayMessage.contacts || []).map(one) }} "
    ": {{ contacts: [one(m.contactMessage || {{}})] }}; }})()"
)


def update_workflow(workflow: dict[str, Any]) -> bool:
    node = next((n for n in workflow["nodes"] if n.get("name") == NODE), None)
    if node is None:
        raise ValueError(f"Falta el nodo requerido: {NODE}")

    assignments = node["parameters"]["assignments"]["assignments"]
    payload = next((a for a in assignments if a.get("name") == "payload"), None)
    if payload is None:
        raise ValueError(f"El nodo {NODE} no tiene un campo payload")
    if "phoneNumber" in payload.get("value", ""):
        return False

    base = CONTACTS_BASE.format(event=event_ref_for(node))
    payload["value"] = build_payload_value(base, event_ref_for(node))
    payload["type"] = "object"
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workflow", type=Path, nargs="+")
    args = parser.parse_args()
    for path in args.workflow:
        workflow = json.loads(path.read_text(encoding="utf-8"))
        changed = update_workflow(workflow)
        if changed:
            path.write_text(json.dumps(workflow, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"{path}: {'actualizado' if changed else 'sin cambios'}")


if __name__ == "__main__":
    main()
