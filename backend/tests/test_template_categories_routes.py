from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from models.schemas import TemplateCategoryCreate, TemplateCategoryUpdate, TemplateCreate
from routers import template_categories, templates
from services.template_category_service import TemplateCategoryAlreadyExistsError


@pytest.mark.asyncio
async def test_create_category_normalizes_spaces_and_tracks_creator(monkeypatch):
    received = None

    async def fake_create(name, user_id):
        nonlocal received
        received = (name, user_id)
        return {"id": 3, "name": name, "is_active": True}

    monkeypatch.setattr(template_categories, "create_template_category", fake_create)

    result = await template_categories.post_category(
        TemplateCategoryCreate(name="  Cierre   comercial "),
        SimpleNamespace(id=11),
    )

    assert received == ("Cierre comercial", 11)
    assert result["name"] == "Cierre comercial"


@pytest.mark.asyncio
async def test_admin_catalog_includes_inactive_categories(monkeypatch):
    expected = [{"id": 1, "name": "Seguimiento", "is_active": True}]
    received = None

    async def fake_list(include_inactive=False):
        nonlocal received
        received = include_inactive
        return expected

    monkeypatch.setattr(template_categories, "list_template_categories", fake_list)

    assert await template_categories.get_all_categories(SimpleNamespace(id=1)) == expected
    assert received is True


@pytest.mark.asyncio
async def test_duplicate_category_is_reported(monkeypatch):
    async def fake_create(_name, _user_id):
        raise TemplateCategoryAlreadyExistsError

    monkeypatch.setattr(template_categories, "create_template_category", fake_create)

    with pytest.raises(HTTPException) as error:
        await template_categories.post_category(
            TemplateCategoryCreate(name="Seguimiento"),
            SimpleNamespace(id=11),
        )

    assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_update_category_passes_normalized_name(monkeypatch):
    received = None

    async def fake_update(category_id, values):
        nonlocal received
        received = (category_id, values)
        return {"id": category_id, "name": values["name"], "is_active": True}

    monkeypatch.setattr(template_categories, "update_template_category", fake_update)

    result = await template_categories.patch_category(
        4,
        TemplateCategoryUpdate(name="  Post   venta "),
        SimpleNamespace(id=1),
    )

    assert received == (4, {"name": "Post venta"})
    assert result["name"] == "Post venta"


@pytest.mark.asyncio
async def test_template_rejects_category_outside_active_catalog(monkeypatch):
    async def category_not_found(_name):
        return None

    monkeypatch.setattr(templates, "get_template_category_by_name", category_not_found)

    with pytest.raises(HTTPException) as error:
        await templates.post_template(
            TemplateCreate(name="Saludo", content="Hola", category="Texto libre"),
            SimpleNamespace(id=11),
        )

    assert error.value.status_code == 400
    assert "categoría activa" in error.value.detail


@pytest.mark.asyncio
async def test_template_uses_canonical_category_name(monkeypatch):
    received = None

    async def category_found(_name):
        return {"id": 1, "name": "Seguimiento", "is_active": True}

    async def fake_create(values, user_id):
        nonlocal received
        received = (values, user_id)
        return {
            "id": 5,
            **values,
            "is_active": True,
            "visibility": "global",
            "is_favorite": False,
            "last_used_at": None,
            "use_count": 0,
            "attachments": [],
        }

    async def fake_broadcast(_payload):
        return None

    monkeypatch.setattr(templates, "get_template_category_by_name", category_found)
    monkeypatch.setattr(templates, "create_template", fake_create)
    monkeypatch.setattr(templates.manager, "broadcast", fake_broadcast)

    await templates.post_template(
        TemplateCreate(name="Saludo", content="Hola", category="seguimiento"),
        SimpleNamespace(id=11),
    )

    assert received[0]["category"] == "Seguimiento"
    assert received[1] == 11
