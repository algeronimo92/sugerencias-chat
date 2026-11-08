from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.modules.catalogs.schemas import (
    LeadServiceCreate,
    LeadServiceUpdate,
    ServicePackageCreate,
    ServicePackageUpdate,
)
from app.modules.catalogs import services_api as lead_services
from app.modules.catalogs.errors import LeadServiceAlreadyExistsError, ServicePackageAlreadyExistsError
from app.modules.catalogs.public import rename_service_references as _rename_service_references


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

    async def fake_update(service_id, values, actor_user_id):
        nonlocal received
        received = (service_id, values, actor_user_id)
        return {"id": service_id, "name": values["name"], "is_active": True}

    monkeypatch.setattr(lead_services, "update_lead_service", fake_update)

    result = await lead_services.patch_service(
        4,
        LeadServiceUpdate(name="  Limpieza   profunda "),
        SimpleNamespace(id=1, role="admin"),
    )

    assert received == (4, {"name": "Limpieza profunda"}, 1)
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


ADMIN = SimpleNamespace(id=1, role="admin")


@pytest.mark.asyncio
async def test_create_package_normalizes_name_and_keeps_price(monkeypatch):
    received = None

    async def fake_create(service_id, values):
        nonlocal received
        received = (service_id, values)
        return {"id": 9, "service_id": service_id, "position": 0, "is_active": True, **values}

    monkeypatch.setattr(lead_services, "create_service_package", fake_create)

    result = await lead_services.post_service_package(
        4,
        ServicePackageCreate(name="  Pack   x3 ", sessions=3, price="400", notes="  "),
        ADMIN,
    )

    assert received == (4, {"name": "Pack x3", "sessions": 3, "price": 400, "notes": None, "position": None})
    assert result["name"] == "Pack x3"


@pytest.mark.asyncio
async def test_create_package_for_missing_service_is_404(monkeypatch):
    async def fake_create(_service_id, _values):
        return None

    monkeypatch.setattr(lead_services, "create_service_package", fake_create)

    with pytest.raises(HTTPException) as error:
        await lead_services.post_service_package(99, ServicePackageCreate(name="x1", price="100"), ADMIN)

    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_create_package_reports_duplicate_name_within_service(monkeypatch):
    async def fake_create(_service_id, _values):
        raise ServicePackageAlreadyExistsError

    monkeypatch.setattr(lead_services, "create_service_package", fake_create)

    with pytest.raises(HTTPException) as error:
        await lead_services.post_service_package(4, ServicePackageCreate(name="Pack x3", price="400"), ADMIN)

    assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_update_package_sends_only_changed_fields(monkeypatch):
    received = None

    async def fake_update(service_id, package_id, values):
        nonlocal received
        received = (service_id, package_id, values)
        return {"id": package_id, "service_id": service_id, "name": "Pack x3", "sessions": 3,
                "price": values["price"], "position": 1, "is_active": True}

    monkeypatch.setattr(lead_services, "update_service_package", fake_update)

    await lead_services.patch_service_package(4, 9, ServicePackageUpdate(price="380"), ADMIN)

    assert received == (4, 9, {"price": 380})


@pytest.mark.asyncio
async def test_update_package_cannot_drop_price(monkeypatch):
    called = False

    async def fake_update(*_args):
        nonlocal called
        called = True

    monkeypatch.setattr(lead_services, "update_service_package", fake_update)

    with pytest.raises(HTTPException) as error:
        await lead_services.patch_service_package(4, 9, ServicePackageUpdate(price=None), ADMIN)

    assert error.value.status_code == 400
    assert called is False


@pytest.mark.asyncio
async def test_update_package_of_other_service_is_404(monkeypatch):
    async def fake_update(_service_id, _package_id, _values):
        return None

    monkeypatch.setattr(lead_services, "update_service_package", fake_update)

    with pytest.raises(HTTPException) as error:
        await lead_services.patch_service_package(4, 9, ServicePackageUpdate(is_active=False), ADMIN)

    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_delete_service_in_use_explains_what_uses_it(monkeypatch):
    from app.modules.catalogs.errors import ServiceInUseError

    async def fake_delete(_service_id):
        raise ServiceInUseError(["12 leads", "1 plantilla", "2 automatizaciones"])

    monkeypatch.setattr(lead_services, "delete_lead_service", fake_delete)

    with pytest.raises(HTTPException) as error:
        await lead_services.remove_service(4, SimpleNamespace(id=1))

    assert error.value.status_code == 409
    assert error.value.detail == (
        "No se puede eliminar porque está en uso: 12 leads, 1 plantilla y 2 automatizaciones. "
        "Desactívalo: deja de ofrecerse y el historial se conserva."
    )


@pytest.mark.asyncio
async def test_delete_missing_service_is_404_and_erp_service_is_409(monkeypatch):
    from app.modules.catalogs.errors import ErpManagedError

    async def missing(_service_id):
        return False

    monkeypatch.setattr(lead_services, "delete_lead_service", missing)
    with pytest.raises(HTTPException) as error:
        await lead_services.remove_service(4, SimpleNamespace(id=1))
    assert error.value.status_code == 404

    async def erp(service_id):
        raise ErpManagedError(service_id)

    monkeypatch.setattr(lead_services, "delete_lead_service", erp)
    with pytest.raises(HTTPException) as error:
        await lead_services.remove_service(4, SimpleNamespace(id=1))
    assert error.value.status_code == 409


def test_references_service_finds_structured_mentions_only():
    from app.modules.catalogs.public import references_service

    assert references_service({"service_contains": "BOTOX"}, "Botox")
    assert references_service([{"nodes": [{"type": "change_service", "service": "botox"}]}], "Botox")
    assert not references_service({"type": "send_text", "text": "Hola, ¿te interesa Botox?"}, "Botox")
    assert not references_service({"service_contains": "Botox capilar"}, "Botox")
