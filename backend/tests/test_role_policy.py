"""El analista solo puede pedir el dashboard y lo que sostiene su sesión."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from app.core.errors import Forbidden
from app.modules.auth import auth_service
from app.modules.auth.role_policy import realtime_allowed_for, route_allowed_for


@pytest.mark.parametrize(("method", "path"), [
    ("GET", "/api/auth/me"),
    ("POST", "/api/auth/logout"),
    ("GET", "/api/auth/sessions"),
    ("GET", "/api/dashboard"),
    ("GET", "/api/lead-stages"),
])
def test_analyst_can_reach_dashboard_and_own_session(method, path):
    assert route_allowed_for("analista", method, path)


@pytest.mark.parametrize(("method", "path"), [
    ("GET", "/api/chats"),
    ("GET", "/api/leads"),
    ("GET", "/api/tasks"),
    ("GET", "/api/appointments"),
    ("GET", "/api/users"),
    ("GET", "/api/notifications"),
    ("POST", "/api/lead-stages"),
    ("GET", "/api/dashboardx"),
    ("GET", "/api/authx"),
])
def test_analyst_is_kept_out_of_the_crm(method, path):
    assert not route_allowed_for("analista", method, path)


@pytest.mark.parametrize("role", ["admin", "vendedor"])
def test_operators_are_not_restricted_by_the_policy(role):
    assert route_allowed_for(role, "GET", "/api/chats")
    assert realtime_allowed_for(role)


def test_analyst_has_no_realtime():
    assert not realtime_allowed_for("analista")


def _resolution(role: str):
    return SimpleNamespace(
        user=SimpleNamespace(id=9, email="a@example.com", name="Ana", role=role, is_active=True),
        session_id="session-id",
        auth_method="password",
        rotated_token=None,
        persistent=False,
        absolute_expires_at=None,
    )


def _client(monkeypatch, role: str) -> TestClient:
    monkeypatch.setattr(auth_service, "resolve_session", AsyncMock(return_value=_resolution(role)))
    app = FastAPI()

    @app.get("/api/dashboard")
    async def dashboard(user=Depends(auth_service.get_current_user)):
        return {"role": user.role}

    @app.get("/api/chats")
    async def chats(user=Depends(auth_service.get_current_user)):
        return {"role": user.role}

    client = TestClient(app)
    client.cookies.set(auth_service.COOKIE_NAME, "token")
    return client


def test_get_current_user_lets_the_analyst_into_the_dashboard(monkeypatch):
    response = _client(monkeypatch, "analista").get("/api/dashboard")
    assert response.status_code == 200
    assert response.json() == {"role": "analista"}


def test_get_current_user_rejects_the_analyst_elsewhere(monkeypatch):
    with pytest.raises(Forbidden):
        _client(monkeypatch, "analista").get("/api/chats")


def test_get_current_user_keeps_sellers_unrestricted(monkeypatch):
    assert _client(monkeypatch, "vendedor").get("/api/chats").status_code == 200
