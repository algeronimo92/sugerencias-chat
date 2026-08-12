from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from models.schemas import LeadServiceCreate, LeadServiceUpdate
from routers import lead_services
from services.db_service import LeadServiceAlreadyExistsError, _rename_service_references


@pytest.mark.asyncio
async def test_list_services_uses_active_catalog(monkeypatch):
    expected = [{"id": 1, "name": "Botox", "is_active": True}]

    async def fake_list():
        return expected

    monkeypatch.setattr(lead_services, "list_lead_services", fake_list)

    assert await lead_services.get_services(SimpleNamespace(id=7)) == expected


@pytest.mark.asyncio
async def test_create_service_normalizes_spaces_and_tracks_creator(monkeypatch):
    received = None

    async def fake_create(name, user_id):
        nonlocal received
        received = (name, user_id)
        return {"id": 3, "name": name, "is_active": True}

    monkeypatch.setattr(lead_services, "create_lead_service", fake_create)

    result = await lead_services.post_service(
        LeadServiceCreate(name="  Limpieza   facial  "),
        SimpleNamespace(id=11),
    )

    assert received == ("Limpieza facial", 11)
    assert result["name"] == "Limpieza facial"


@pytest.mark.asyncio
async def test_create_service_reports_duplicate_name(monkeypatch):
    async def fake_create(_name, _user_id):
        raise LeadServiceAlreadyExistsError

    monkeypatch.setattr(lead_services, "create_lead_service", fake_create)

    with pytest.raises(HTTPException) as error:
        await lead_services.post_service(
            LeadServiceCreate(name="Botox"),
            SimpleNamespace(id=11),
        )

    assert error.value.status_code == 409
    assert error.value.detail == "Ya existe un servicio con ese nombre"


@pytest.mark.asyncio
async def test_admin_catalog_includes_inactive_services(monkeypatch):
    expected = [
        {"id": 1, "name": "Botox", "is_active": True},
        {"id": 2, "name": "Servicio anterior", "is_active": False},
    ]
    received = None

    async def fake_list(include_inactive=False):
        nonlocal received
        received = include_inactive
        return expected

    monkeypatch.setattr(lead_services, "list_lead_services", fake_list)

    result = await lead_services.get_all_services(SimpleNamespace(id=1, role="admin"))

    assert received is True
    assert result == expected


@pytest.mark.asyncio
async def test_update_service_normalizes_name(monkeypatch):
    received = None

    async def fake_update(service_id, values):
        nonlocal received
        received = (service_id, values)
        return {"id": service_id, "name": values["name"], "is_active": True}

    monkeypatch.setattr(lead_services, "update_lead_service", fake_update)

    result = await lead_services.patch_service(
        4,
        LeadServiceUpdate(name="  Limpieza   profunda "),
        SimpleNamespace(id=1, role="admin"),
    )

    assert received == (4, {"name": "Limpieza profunda"})
    assert result["name"] == "Limpieza profunda"


def test_rename_service_updates_only_structured_automation_references():
    definition = {
        "conditions": {"service_contains": "Botox"},
        "nodes": [
            {"data": {"action": {"type": "change_service", "service": "botox"}}},
            {"data": {"action": {"type": "send_message", "text": "Consulta por Botox"}}},
        ],
    }

    renamed, changed = _rename_service_references(definition, "Botox", "Botox premium")

    assert changed is True
    assert renamed["conditions"]["service_contains"] == "Botox premium"
    assert renamed["nodes"][0]["data"]["action"]["service"] == "Botox premium"
    assert renamed["nodes"][1]["data"]["action"]["text"] == "Consulta por Botox"
