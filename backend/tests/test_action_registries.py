"""Cada tipo de acción se define en registros paralelos: el que la valida al
guardar la regla, el que la ejecuta y el catálogo que la ofrece en el
formulario. Si alguno se queda corto, el tipo se acepta al guardar y revienta
al correr, o queda muerto sin que nadie lo note."""

import re
from pathlib import Path

import pytest

from services.automations.actions import ACTION_HANDLERS
from services.automations.common import ACTION_TYPES
from services.automations.rule_validation import ACTION_NORMALIZERS

FRONTEND_CATALOG = (
    Path(__file__).resolve().parents[2] / "frontend/src/domain/automationCatalog.ts"
)


def test_every_action_type_has_a_normalizer():
    assert set(ACTION_NORMALIZERS) == set(ACTION_TYPES)


def test_every_action_type_has_a_handler():
    assert set(ACTION_HANDLERS) == set(ACTION_TYPES)


@pytest.mark.skipif(not FRONTEND_CATALOG.exists(), reason="el frontend no está en este checkout")
def test_the_frontend_catalog_offers_exactly_the_supported_actions():
    source = FRONTEND_CATALOG.read_text(encoding="utf-8")
    block = re.search(
        r"export const AutomationActionType = \{(.*?)\} as const", source, re.DOTALL,
    )
    assert block, "No se encontró el catálogo de acciones del frontend"
    offered = set(re.findall(r"'([a-z_]+)'", block.group(1)))
    assert offered == {str(action) for action in ACTION_TYPES}
