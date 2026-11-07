"""Lo que el sincronizador decide sin tocar la base: validar el catálogo del
ERP, cuándo le toca al worker, y cómo responden las rutas."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.modules.catalogs import erp_catalog
from app.modules.catalogs import services_api
from app.modules.catalogs.erp_catalog import ErpCatalogError, parse_catalog
from app.modules.catalogs.errors import ErpManagedError
from app.modules.catalogs.schemas import LeadServiceUpdate, ServicePackageCreate
from app.modules.platform.settings_service import validate_erp_catalog_url

ADMIN = SimpleNamespace(id=1, role="admin")

ERP_PAYLOAD = {
    "data": [
        {
            "id": "svc-1", "name": "  Hollywood   Peel - Rostro ", "description": None, "icon": None,
            "packages": [
                {"id": "svc-1", "sessions": 1, "price": "180", "label": "Individual"},
                {"id": "pk-3", "sessions": 3, "price": "400", "label": "x3"},
            ],
        },
        {"id": "svc-2", "name": "Consulta", "description": None, "icon": None, "packages": []},
    ]
}


def test_parse_catalog_normalizes_names_and_prices():
    services = parse_catalog(ERP_PAYLOAD)

    assert [service.name for service in services] == ["Hollywood Peel - Rostro", "Consulta"]
    assert services[0].packages[1].price == Decimal("400")
    assert services[0].packages[1].sessions == 3
    assert services[1].packages == []


def test_parse_catalog_rejects_unexpected_shape():
    with pytest.raises(ErpCatalogError) as error:
        parse_catalog({"items": []})
    assert "formato esperado" in str(error.value)

    with pytest.raises(ErpCatalogError):
        parse_catalog({"data": [{"id": "x", "name": "Peel", "packages": [{"id": "p", "sessions": 0, "price": "1", "label": "a"}]}]})


def test_parse_catalog_rejects_duplicate_service_names_case_insensitive():
    payload = {"data": [
        {"id": "a", "name": "Botox", "packages": []},
        {"id": "b", "name": "botox", "packages": []},
    ]}
    with pytest.raises(ErpCatalogError) as error:
        parse_catalog(payload)
    assert "botox" in str(error.value).lower()


def test_parse_catalog_rejects_duplicate_package_labels_in_a_service():
    payload = {"data": [{"id": "a", "name": "Botox", "packages": [
        {"id": "p1", "sessions": 1, "price": "1", "label": "x1"},
        {"id": "p2", "sessions": 2, "price": "2", "label": "X1"},
    ]}]}
    with pytest.raises(ErpCatalogError):
        parse_catalog(payload)


def test_erp_url_must_be_http():
    assert validate_erp_catalog_url("  https://erp.example.test/api/public/catalog ") == "https://erp.example.test/api/public/catalog"
    assert validate_erp_catalog_url("   ") == ""
    with pytest.raises(ValueError):
        validate_erp_catalog_url("erp.example.test/catalog")
    with pytest.raises(ValueError):
        validate_erp_catalog_url("ftp://erp.example.test/catalog")


async def test_tick_skips_without_url_and_when_recent(monkeypatch):
    calls = []

    async def fake_sync(fetch=None):
        calls.append(fetch)

    monkeypatch.setattr(erp_catalog, "sync_catalog", fake_sync)

    async def no_url(_keys):
        return {"erp_catalog_url": "", "erp_catalog_synced_at": ""}

    monkeypatch.setattr(erp_catalog, "get_effective_many", no_url)
    await erp_catalog.erp_catalog_tick()
    assert calls == []

    recent = (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat()

    async def recent_sync(_keys):
        return {"erp_catalog_url": "https://erp.test/c", "erp_catalog_synced_at": recent}

    monkeypatch.setattr(erp_catalog, "get_effective_many", recent_sync)
    await erp_catalog.erp_catalog_tick()
    assert calls == []


async def test_tick_syncs_when_due_and_survives_erp_errors(monkeypatch):
    stale = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()

    async def due(_keys):
        return {"erp_catalog_url": "https://erp.test/c", "erp_catalog_synced_at": stale}

    monkeypatch.setattr(erp_catalog, "get_effective_many", due)
    calls = []

    async def failing_sync(fetch=None):
        calls.append(1)
        raise ErpCatalogError("ERP caído")

    monkeypatch.setattr(erp_catalog, "sync_catalog", failing_sync)
    await erp_catalog.erp_catalog_tick()
    assert calls == [1]


async def test_sync_catalog_records_error_and_reraises(monkeypatch):
    recorded = {}

    async def url(_keys):
        return {"erp_catalog_url": "https://erp.test/c"}

    async def record(values):
        recorded.update(values)

    monkeypatch.setattr(erp_catalog, "get_effective_many", url)
    monkeypatch.setattr(erp_catalog, "update_settings", record)

    async def broken_fetch(_url):
        return {"nope": True}

    with pytest.raises(ErpCatalogError):
        await erp_catalog.sync_catalog(broken_fetch)
    assert "formato esperado" in recorded["erp_catalog_last_error"]


async def test_sync_catalog_records_success(monkeypatch):
    recorded = {}

    async def url(_keys):
        return {"erp_catalog_url": "https://erp.test/c"}

    async def record(values):
        recorded.update(values)

    async def fake_apply(services):
        return erp_catalog.SyncSummary(services_total=len(services), services_created=len(services))

    async def fake_status():
        return {"configured": True}

    monkeypatch.setattr(erp_catalog, "get_effective_many", url)
    monkeypatch.setattr(erp_catalog, "update_settings", record)
    monkeypatch.setattr(erp_catalog, "apply_catalog", fake_apply)
    monkeypatch.setattr(erp_catalog, "sync_status", fake_status)

    async def fetch(_url):
        return ERP_PAYLOAD

    assert await erp_catalog.sync_catalog(fetch) == {"configured": True}
    assert recorded["erp_catalog_last_error"] == ""
    assert '"services_created": 2' in recorded["erp_catalog_last_summary"]
    assert recorded["erp_catalog_synced_at"]


async def test_sync_catalog_requires_url(monkeypatch):
    async def no_url(_keys):
        return {"erp_catalog_url": " "}

    monkeypatch.setattr(erp_catalog, "get_effective_many", no_url)
    with pytest.raises(ErpCatalogError):
        await erp_catalog.sync_catalog()


async def test_run_erp_sync_route_translates_erp_errors(monkeypatch):
    async def failing():
        raise ErpCatalogError("El ERP respondió 500 al pedir el catálogo")

    monkeypatch.setattr(services_api, "sync_catalog", failing)
    with pytest.raises(HTTPException) as error:
        await services_api.run_erp_sync(ADMIN)
    assert error.value.status_code == 502
    assert "500" in error.value.detail


async def test_erp_managed_service_rejects_manual_rename_and_packages(monkeypatch):
    async def managed(*_args, **_kwargs):
        raise ErpManagedError(4)

    monkeypatch.setattr(services_api, "update_lead_service", managed)
    monkeypatch.setattr(services_api, "create_service_package", managed)

    with pytest.raises(HTTPException) as error:
        await services_api.patch_service(4, LeadServiceUpdate(name="Otro"), ADMIN)
    assert error.value.status_code == 409
    assert "ERP" in error.value.detail

    with pytest.raises(HTTPException) as error:
        await services_api.post_service_package(4, ServicePackageCreate(name="x2", sessions=2, price="100"), ADMIN)
    assert error.value.status_code == 409
