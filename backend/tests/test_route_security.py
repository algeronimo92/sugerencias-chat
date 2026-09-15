from fastapi.routing import APIRoute
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect
import pytest

import main
from services.auth_service import (
    get_current_user,
    require_admin,
    verify_webhook_token,
    websocket_origin_allowed,
)

AUTH_GUARDS = {get_current_user, require_admin, verify_webhook_token}

PUBLIC_ROUTES = {
    ("POST", "/api/auth/login"),
    ("POST", "/api/auth/logout"),
    ("GET", "/api/auth/pin/status"),
    ("POST", "/api/auth/pin/login"),
    ("GET", "/health"),
    ("GET", "/health/ready"),
    ("GET", "/metrics"),
}


def _is_guarded(dependant) -> bool:
    return any(dep.call in AUTH_GUARDS or _is_guarded(dep) for dep in dependant.dependencies)


def test_every_api_route_requires_authentication_unless_explicitly_public():
    unguarded = {
        (method, route.path)
        for route in main.app.routes
        if isinstance(route, APIRoute) and not _is_guarded(route.dependant)
        for method in route.methods
    }

    assert unguarded - PUBLIC_ROUTES == set()


@pytest.mark.parametrize(("origin", "host", "allowed"), [
    ("https://dermicapro.cliniventas.com", "dermicapro.cliniventas.com", True),
    ("http://localhost:5174", "localhost:8000", True),
    (None, "dermicapro.cliniventas.com", True),
    ("https://otra.cliniventas.com", "dermicapro.cliniventas.com", False),
    ("https://evil.example", "localhost:8000", False),
])
def test_websocket_origin_must_be_same_host_or_configured(origin, host, allowed):
    assert websocket_origin_allowed(origin, host, ["http://localhost:5174"]) is allowed


def test_websocket_rejects_foreign_origin_before_reading_the_session(monkeypatch):
    async def fail_if_called(_token):
        pytest.fail("no debe resolver la sesión de un origen ajeno")

    monkeypatch.setattr(main, "get_user_from_token", fail_if_called)
    client = TestClient(main.app)

    with pytest.raises(WebSocketDisconnect) as closed:
        with client.websocket_connect("/ws/chats", headers={"origin": "https://evil.example"}):
            pass

    assert closed.value.code == 4403
