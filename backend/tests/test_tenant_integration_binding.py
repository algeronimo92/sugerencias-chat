from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from tenancy import dependencies
from tenancy.context import TenantContext, get_current_tenant

from uuid import uuid4


def test_inbox_and_signed_ai_paths_are_self_scoped() -> None:
    assert dependencies.integration_path_is_self_scoped(
        "/api/webhooks/meta-events/inbox"
    )
    assert dependencies.integration_path_is_self_scoped(
        "/api/webhooks/meta-events/inbox/00000000-0000-0000-0000-000000000001/complete"
    )
    assert dependencies.integration_path_is_self_scoped(
        "/api/webhooks/analysis-jobs/job/apply"
    )
    assert dependencies.integration_path_is_self_scoped(
        "/api/webhooks/meta/verify-challenge"
    )
    assert dependencies.integration_path_is_self_scoped(
        "/api/webhooks/meta/verify-signature"
    )
    assert not dependencies.integration_path_is_self_scoped(
        "/api/webhooks/save-inbound-message"
    )


@pytest.mark.asyncio
async def test_meta_binding_fails_closed_without_phone_number(monkeypatch) -> None:
    monkeypatch.setattr(dependencies.settings, "multitenancy_enabled", True)
    request = SimpleNamespace(
        url=SimpleNamespace(path="/api/webhooks/save-inbound-message"),
        state=SimpleNamespace(),
    )
    generator = dependencies.bind_integration_tenant(request, None)
    with pytest.raises(HTTPException) as caught:
        await anext(generator)
    assert caught.value.status_code == 400
    assert get_current_tenant() is None


@pytest.mark.asyncio
async def test_meta_binding_resolves_account_event_by_waba(monkeypatch) -> None:
    monkeypatch.setattr(dependencies.settings, "multitenancy_enabled", True)
    expected = TenantContext(
        organization_id=uuid4(),
        schema_name=f"tenant_{uuid4().hex}",
        hostname="clinica.test",
    )

    async def fake_resolve(waba_id: str):
        assert waba_id == "WABA_1"
        return expected

    monkeypatch.setattr(dependencies, "resolve_tenant_by_waba_id", fake_resolve)
    request = SimpleNamespace(
        url=SimpleNamespace(path="/api/webhooks/templates/META_1"),
        state=SimpleNamespace(),
    )
    generator = dependencies.bind_integration_tenant(request, None, "WABA_1")
    await anext(generator)
    try:
        assert get_current_tenant() == expected
        assert request.state.tenant_context == expected
    finally:
        await generator.aclose()
    assert get_current_tenant() is None
