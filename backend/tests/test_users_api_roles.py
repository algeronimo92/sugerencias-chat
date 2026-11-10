"""Alta y cambio de rol desde Configuración → Usuarios."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.modules.auth import users_api
from app.modules.auth.auth_service import require_admin

ADMIN = SimpleNamespace(id=1, email="admin@example.com", name="Admin", role="admin", is_active=True)


def _user(user_id: int, role: str) -> dict:
    return {"id": user_id, "email": f"u{user_id}@example.com", "name": "Usuario", "role": role, "is_active": True}


@pytest.fixture
def client(monkeypatch) -> TestClient:
    monkeypatch.setattr(users_api, "invite_user", AsyncMock(side_effect=lambda **kw: _user(2, kw["role"])))
    monkeypatch.setattr(users_api, "update_user", AsyncMock(side_effect=lambda user_id, values: _user(user_id, values.get("role", "vendedor"))))
    monkeypatch.setattr(users_api, "invalidate_user_cache", lambda *_: None)
    app = FastAPI()
    app.include_router(users_api.router)
    app.dependency_overrides[require_admin] = lambda: ADMIN
    return TestClient(app)


def test_an_analyst_can_be_invited(client):
    response = client.post("/api/users", json={"email": "ana@example.com", "name": "Ana", "role": "analista"})
    assert response.status_code == 201
    assert response.json()["role"] == "analista"
    assert users_api.invite_user.await_args.kwargs["role"] == "analista"


def test_unknown_roles_are_rejected(client):
    response = client.post("/api/users", json={"email": "x@example.com", "name": "X", "role": "gerente"})
    assert response.status_code == 400
    users_api.invite_user.assert_not_awaited()


def test_a_user_can_be_moved_to_analyst(client):
    response = client.patch("/api/users/2", json={"role": "analista"})
    assert response.status_code == 200
    assert response.json()["role"] == "analista"


def test_the_admin_cannot_demote_themselves_to_analyst(client):
    response = client.patch(f"/api/users/{ADMIN.id}", json={"role": "analista"})
    assert response.status_code == 400
    users_api.update_user.assert_not_awaited()
