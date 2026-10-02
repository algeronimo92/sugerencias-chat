"""Botones de una plantilla interna: Meta solo acepta "reply" fuera de una
plantilla oficial (URL, llamada o copiar código rechazan siempre con
"interactive.action.buttons.N.reply is required", confirmado con tráfico
real). La configuración se guarda con la estructura nativa de Meta."""

from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.modules.catalogs.schemas import TemplateCreate
from app.modules.catalogs import templates_api as templates


def _buttons_payload(buttons, **overrides):
    values = dict(
        name="Turnos",
        content="Elige una opción",
        category="Seguimiento",
        template_type="internal",
        interactive_type="button",
        interactive_config={
            "header": {"type": "text", "text": "Elige una opción"},
            "footer": {"text": "DermicaPro"},
            "action": {"buttons": buttons},
        },
    )
    values.update(overrides)
    return TemplateCreate(**values)


async def _category_found(_name):
    return {"id": 1, "name": "Seguimiento", "is_active": True}


@pytest.mark.asyncio
async def test_internal_buttons_reject_url_type(monkeypatch):
    monkeypatch.setattr(templates, "get_template_category_by_name", _category_found)

    payload = _buttons_payload([
        {"type": "url", "url": "https://cliniventas.com/"},
    ])

    with pytest.raises(HTTPException) as error:
        await templates.post_template(payload, SimpleNamespace(id=11))

    assert error.value.status_code == 400
    assert "reply" in error.value.detail


@pytest.mark.asyncio
async def test_internal_buttons_accept_reply_only(monkeypatch):
    received = None

    async def fake_create_template(values, user_id):
        nonlocal received
        received = values
        return {"id": 7, **values, "is_active": True, "visibility": "global",
                "is_favorite": False, "last_used_at": None, "use_count": 0, "attachments": []}

    async def fake_broadcast(_payload):
        return None

    monkeypatch.setattr(templates, "get_template_category_by_name", _category_found)
    monkeypatch.setattr(templates, "create_template", fake_create_template)
    monkeypatch.setattr(templates.manager, "broadcast", fake_broadcast)

    payload = _buttons_payload([{"type": "reply", "reply": {"id": "reply_1", "title": "Mañana"}}])

    await templates.post_template(payload, SimpleNamespace(id=11))

    assert received["interactive_config"]["action"]["buttons"] == [
        {"type": "reply", "reply": {"id": "reply_1", "title": "Mañana"}},
    ]
