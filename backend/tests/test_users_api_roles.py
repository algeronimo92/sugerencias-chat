"""Alta, cambio de rol y de correo, y enlace de invitación desde Configuración → Usuarios."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.integrations.email_service import EmailNotConfiguredError
from app.modules.auth import users_api
from app.modules.auth.auth_service import require_admin
from app.modules.auth.errors import EmailAlreadyExistsError, UserAlreadyActiveError

ADMIN = SimpleNamespace(id=1, email="admin@example.com", name="Admin", role="admin", is_active=True)


def _user(user_id: int, role: str) -> dict:
    return {
        "id": user_id,
        "email": f"u{user_id}@example.com",
        "name": "Usuario",
        "role": role,
        "is_active": True,
        "invitation_pending": False,
    }


def _pending(user_id: int) -> dict:
    return {**_user(user_id, "vendedor"), "is_active": False, "invitation_pending": True}


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


def test_a_pending_invitation_email_is_corrected_normalized_and_its_old_link_dies(client, monkeypatch):
    monkeypatch.setattr(users_api, "update_user", AsyncMock(return_value=_pending(3)))
    monkeypatch.setattr(users_api, "revoke_pending_invitations", AsyncMock())
    response = client.patch("/api/users/3", json={"email": "  Nuevo@Example.com "})
    assert response.status_code == 200
    assert users_api.update_user.await_args.args == (3, {"email": "nuevo@example.com"})
    users_api.revoke_pending_invitations.assert_awaited_once_with(3)


def test_the_email_of_an_activated_account_cannot_be_changed(client, monkeypatch):
    monkeypatch.setattr(users_api, "update_user", AsyncMock(side_effect=UserAlreadyActiveError()))
    monkeypatch.setattr(users_api, "revoke_pending_invitations", AsyncMock())
    response = client.patch("/api/users/2", json={"email": "otra@example.com"})
    assert response.status_code == 409
    assert "pendiente" in response.json()["detail"]
    users_api.revoke_pending_invitations.assert_not_awaited()


def test_a_malformed_email_is_rejected(client):
    response = client.patch("/api/users/2", json={"email": "sin-arroba"})
    assert response.status_code == 400
    users_api.update_user.assert_not_awaited()


def test_an_email_in_use_by_another_account_is_rejected(client, monkeypatch):
    monkeypatch.setattr(users_api, "update_user", AsyncMock(side_effect=EmailAlreadyExistsError("x")))
    response = client.patch("/api/users/2", json={"email": "u1@example.com"})
    assert response.status_code == 409


def test_the_admin_can_copy_an_invitation_link(client, monkeypatch):
    issued = {"url": "https://acme.example.com/accept-invitation?token=abc", "expires_at": "2026-11-13T10:00:00Z"}
    monkeypatch.setattr(users_api, "issue_invitation_link", AsyncMock(return_value=issued))
    response = client.post("/api/users/3/invitation-link")
    assert response.status_code == 200
    assert response.json()["url"] == issued["url"]
    users_api.issue_invitation_link.assert_awaited_once_with(3)


def test_no_invitation_link_for_an_account_already_active(client, monkeypatch):
    monkeypatch.setattr(users_api, "issue_invitation_link", AsyncMock(side_effect=UserAlreadyActiveError()))
    response = client.post("/api/users/2/invitation-link")
    assert response.status_code == 409


def test_a_deactivated_account_is_not_reinvited(client, monkeypatch):
    deactivated = {**_user(4, "vendedor"), "is_active": False, "invitation_pending": False}
    monkeypatch.setattr(users_api, "get_user_by_id", AsyncMock(return_value=SimpleNamespace(**deactivated)))
    response = client.post("/api/users/4/resend-invitation")
    assert response.status_code == 409
    users_api.invite_user.assert_not_awaited()


def test_invitation_link_needs_a_public_url(client, monkeypatch):
    monkeypatch.setattr(users_api, "issue_invitation_link", AsyncMock(side_effect=EmailNotConfiguredError("no url")))
    response = client.post("/api/users/3/invitation-link")
    assert response.status_code == 503


def test_a_phone_is_stored_as_the_whatsapp_id_and_empty_clears_it(client, monkeypatch):
    # El aviso de cita al equipo le escribe a este número: se guarda como lo
    # identifica Meta, con el código de país del negocio si no lo trae.
    monkeypatch.setattr(users_api, "effective_country_code", AsyncMock(return_value="51"))

    assert client.patch("/api/users/2", json={"phone": "927 345 336"}).status_code == 200
    assert users_api.update_user.await_args.args == (2, {"phone": "51927345336"})

    assert client.patch("/api/users/2", json={"phone": " "}).status_code == 200
    assert users_api.update_user.await_args.args == (2, {"phone": None})

    assert client.patch("/api/users/2", json={"phone": "12"}).status_code == 400
