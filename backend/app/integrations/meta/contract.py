"""Contrato de mensajes de Meta WhatsApp Cloud API.

La fuente es ``contracts/meta_messages.json``: backend y frontend leen las
mismas listas (el frontend a través de ``frontend/src/features/whatsapp/domain/metaContract.ts``,
generado con ``python -m scripts.export_meta_contract``).

El registro sirve para validar lo que sale y para elegir cómo mostrar lo que
entra. Nunca para descartar datos: un tipo que Meta agregue mañana se guarda
con su nombre literal y solo dispara una alerta porque todavía no tiene un
renderer (ver ``is_known_inbound``).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Any

CONTRACT_PATH = Path(__file__).resolve().parents[3] / "contracts" / "meta_messages.json"


@dataclass(frozen=True)
class DirectionContract:
    root_types: frozenset[str]
    subtypes: dict[str, frozenset[str]]


@dataclass(frozen=True)
class MetaContract:
    version: str
    inbound: DirectionContract
    outbound: DirectionContract
    capabilities: dict[str, str]
    window_exempt_root_types: frozenset[str]
    subtype_fields: dict[str, str]
    media_root_types: frozenset[str]
    statuses: tuple[str, ...]
    limits: dict[str, int]


def _direction(raw: dict[str, Any]) -> DirectionContract:
    return DirectionContract(
        root_types=frozenset(raw["root_types"]),
        subtypes={root: frozenset(values) for root, values in raw["subtypes"].items()},
    )


def load_contract_data() -> dict[str, Any]:
    return json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def contract() -> MetaContract:
    raw = load_contract_data()
    return MetaContract(
        version=raw["version"],
        inbound=_direction(raw["inbound"]),
        outbound=_direction(raw["outbound"]),
        capabilities=dict(raw["outbound"]["capabilities"]),
        window_exempt_root_types=frozenset(raw["outbound"]["window_exempt_root_types"]),
        subtype_fields=dict(raw["subtype_fields"]),
        media_root_types=frozenset(raw["media_root_types"]),
        statuses=tuple(raw["statuses"]),
        limits=dict(raw["limits"]),
    )


def message_subtype(message: dict[str, Any]) -> str | None:
    """Subtipo literal de un mensaje Meta (``interactive.type``, ``system.type``).

    Se lee del objeto anidado que lleva el nombre de la raíz, igual que lo
    manda Meta. ``None`` si la raíz no tiene subtipos o el valor no vino.
    """
    root = message.get("type")
    field = contract().subtype_fields.get(root) if isinstance(root, str) else None
    if field is None:
        return None
    nested = message.get(root)
    value = nested.get(field) if isinstance(nested, dict) else None
    return value if isinstance(value, str) and value else None


def is_known_inbound(message_type: str | None, subtype: str | None) -> bool:
    """Si la UI tiene un renderer para esta combinación de entrada."""
    inbound = contract().inbound
    if message_type not in inbound.root_types:
        return False
    allowed = inbound.subtypes.get(message_type)
    return allowed is None or subtype is None or subtype in allowed


def capability_for(message_type: str, subtype: str | None) -> str | None:
    """Capacidad de la cuenta que exige esta salida, o ``None`` si no exige."""
    capabilities = contract().capabilities
    if subtype is not None:
        key = f"{message_type}/{subtype}"
        if key in capabilities:
            return capabilities[key]
    return capabilities.get(message_type)


def limit(name: str) -> int:
    return contract().limits[name]
