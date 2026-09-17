from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from uuid import uuid4

import pytest

from services import dashboard_service, session_service, settings_service
from tenancy.context import TenantContext, tenant_context


def _tenant(label: str) -> TenantContext:
    return TenantContext(uuid4(), f"tenant_{uuid4().hex}", f"{label}.example.test")


@pytest.mark.asyncio
async def test_settings_cache_is_partitioned_by_tenant(monkeypatch) -> None:
    tenant_a = _tenant("a")
    tenant_b = _tenant("b")
    settings_service.invalidate_settings_cache(all_tenants=True)

    async def fake_db_values():
        from tenancy.context import get_current_tenant

        context = get_current_tenant()
        return {"meta_phone_number_id": str(context.organization_id)}

    monkeypatch.setattr(settings_service, "_db_values", fake_db_values)

    with tenant_context(tenant_a):
        value_a = await settings_service.get_effective("meta_phone_number_id")
    with tenant_context(tenant_b):
        value_b = await settings_service.get_effective("meta_phone_number_id")
    with tenant_context(tenant_a):
        cached_a = await settings_service.get_effective("meta_phone_number_id")

    assert value_a == cached_a == str(tenant_a.organization_id)
    assert value_b == str(tenant_b.organization_id)


@pytest.mark.asyncio
async def test_dashboard_cache_does_not_cross_tenants(monkeypatch) -> None:
    from tenancy.context import get_current_tenant

    tenant_a = _tenant("a")
    tenant_b = _tenant("b")
    dashboard_service._cache.clear()

    async def fake_metrics(_days: int):
        return {"organization_id": str(get_current_tenant().organization_id)}

    monkeypatch.setattr(dashboard_service, "_compute_dashboard_metrics", fake_metrics)

    with tenant_context(tenant_a):
        result_a = await dashboard_service.get_dashboard_metrics(30)
    with tenant_context(tenant_b):
        result_b = await dashboard_service.get_dashboard_metrics(30)

    assert result_a != result_b


def test_session_cache_key_contains_tenant() -> None:
    tenant_a = _tenant("a")
    tenant_b = _tenant("b")
    now = datetime.now(timezone.utc)
    resolution = session_service.SessionResolution(
        user=SimpleNamespace(id=1),
        session_id="session",
        absolute_expires_at=now + timedelta(hours=2),
        persistent=True,
        auth_method="cookie",
        idle_expires_at=now + timedelta(hours=1),
    )
    session_service._session_cache.clear()

    with tenant_context(tenant_a):
        session_service._cache_resolution("same-digest", resolution)
        assert session_service._cached_resolution("same-digest") is not None
    with tenant_context(tenant_b):
        assert session_service._cached_resolution("same-digest") is None
