from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from tenancy import dependencies
from tenancy.context import get_current_tenant


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
