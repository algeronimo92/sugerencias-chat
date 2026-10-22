import pytest

from app.modules.catalogs import custom_fields
from app.modules.catalogs.custom_fields import CustomFieldError


@pytest.fixture
def definitions(monkeypatch):
    rows = [
        {"id": 1, "entity_type": "appointment", "key": "sede", "label": "Sede", "field_type": "select", "required": True, "options": ["Centro", "Norte"], "position": 0, "is_active": True},
        {"id": 2, "entity_type": "appointment", "key": "personas", "label": "Personas", "field_type": "number", "required": False, "options": [], "position": 1, "is_active": True},
    ]
    async def list_items(*_args, **_kwargs): return rows
    monkeypatch.setattr(custom_fields, "list_definitions", list_items)
    return rows


async def test_normalizes_business_fields(definitions):
    assert await custom_fields.normalize_values("appointment", {"sede": "Centro", "personas": "3"}, require_required=True) == {"sede": "Centro", "personas": 3.0}


async def test_rejects_missing_required_field(definitions):
    with pytest.raises(CustomFieldError, match="Sede"):
        await custom_fields.normalize_values("appointment", {"personas": 2}, require_required=True)


async def test_rejects_unknown_or_invalid_option(definitions):
    with pytest.raises(CustomFieldError, match="desconocidos"):
        await custom_fields.normalize_values("appointment", {"otro": "x"}, require_required=False)
    with pytest.raises(CustomFieldError, match="opción inválida"):
        await custom_fields.normalize_values("appointment", {"sede": "Sur"}, require_required=False)
