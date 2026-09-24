"""Genera ``frontend/src/domain/metaContract.ts`` desde el contrato del backend.

Uso:
    python -m scripts.export_meta_contract            # escribe el archivo
    python -m scripts.export_meta_contract --check    # falla si está desactualizado

El test ``tests/test_meta_contract.py`` corre la misma comparación, así que un
cambio en ``contracts/meta_messages.json`` sin regenerar no pasa la suite.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from services.meta_contract import load_contract_data

TARGET = Path(__file__).resolve().parents[2] / "frontend" / "src" / "domain" / "metaContract.ts"

HEADER = """\
// Generado por backend/scripts/export_meta_contract.py desde
// backend/contracts/meta_messages.json. No editar a mano: cambiar el JSON y
// volver a correr `python -m scripts.export_meta_contract` desde backend/.
"""

FOOTER = """
export type MetaInboundRootType = (typeof META_CONTRACT.inbound.root_types)[number]
export type MetaOutboundRootType = (typeof META_CONTRACT.outbound.root_types)[number]
export type MetaInboundInteractiveSubtype = (typeof META_CONTRACT.inbound.subtypes.interactive)[number]
export type MetaOutboundInteractiveSubtype = (typeof META_CONTRACT.outbound.subtypes.interactive)[number]
export type MetaStatus = (typeof META_CONTRACT.statuses)[number]
export type MetaMediaRootType = (typeof META_CONTRACT.media_root_types)[number]
"""


def render() -> str:
    data = load_contract_data()
    body = json.dumps(data, indent=2, ensure_ascii=False)
    return f"{HEADER}\nexport const META_CONTRACT = {body} as const\n{FOOTER}"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    expected = render()
    if args.check:
        current = TARGET.read_text(encoding="utf-8") if TARGET.exists() else ""
        if current != expected:
            print(f"{TARGET} está desactualizado", file=sys.stderr)
            return 1
        return 0
    TARGET.write_text(expected, encoding="utf-8", newline="\n")
    print(f"Escrito {TARGET}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
