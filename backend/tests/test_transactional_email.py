"""Contratos públicos del correo, sin conectar a SMTP ni PostgreSQL."""

from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.modules.auth import api as auth
from app.modules.auth import users_api as users
from app.integrations import email_service
from app.modules.auth.account_actions import INVITATION, InvalidActionTokenError
from app.modules.auth.auth_service import require_admin
from app.integrations.email_service import EmailNotConfiguredError
from app.tenancy.context import TenantContext


def _auth_client() -> TestClient:
    app = FastAPI()
    app.include_router(auth.router)
    return TestClient(app)


def test_forgot_password_always_returns_generic_message(monkeypatch) -> None:
    request = AsyncMock(return_value=None)
    monkeypatch.setattr(auth, "request_password_reset", request)

    response = _auth_client().post(
        "/api/auth/forgot-password", json={"email": "unknown@example.com"}
    )

    assert response.status_code == 202
    assert "Si existe una cuenta activa" in response.json()["message"]
    assert "unknown@example.com" not in response.text
    request.assert_awaited_once_with("unknown@example.com")


def test_invalid_action_token_has_no_account_details(monkeypatch) -> None:
    monkeypatch.setattr(
        auth, "describe_action_token", AsyncMock(side_effect=InvalidActionTokenError())
    )

    response = _auth_client().get("/api/auth/action-token/not-a-real-token")

    assert response.status_code == 400
    assert response.json() == {"detail": "El enlace no es válido o ya venció"}


def test_invitation_completion_is_bound_to_its_purpose(monkeypatch) -> None:
    consume = AsyncMock(return_value=None)
    monkeypatch.setattr(auth, "consume_action_token", consume)
    token = "x" * 43

    response = _auth_client().post(
        "/api/auth/accept-invitation",
        json={"token": token, "password": "a-secure-password"},
    )

    assert response.status_code == 200
    consume.assert_awaited_once_with(
        token=token, purpose=INVITATION, password="a-secure-password"
    )


def test_tenant_email_url_uses_resolved_context_not_request_host(monkeypatch) -> None:
    context = TenantContext(
        UUID("21675109-1111-2222-3333-444444444444"),
        "tenant_21675109111122223333444444444444",
        "acme.example.com",
    )
    monkeypatch.setattr(email_service, "get_current_tenant", lambda: context)
    monkeypatch.setattr(email_service.settings, "app_public_scheme", "https")
    monkeypatch.setattr(email_service.settings, "app_public_url", "https://attacker.invalid")

    assert email_service.public_app_url() == "https://acme.example.com"


def test_email_is_disabled_when_transport_is_incomplete(monkeypatch) -> None:
    monkeypatch.setattr(email_service.settings, "email_provider", "smtp")
    monkeypatch.setattr(email_service.settings, "smtp_host", "")
    monkeypatch.setattr(email_service.settings, "email_from_address", "no-reply@example.com")

    assert email_service.email_is_configured() is False


def _users_client() -> TestClient:
    app = FastAPI()
    app.include_router(users.router)
    admin = SimpleNamespace(id=1, role="admin")
    app.dependency_overrides[require_admin] = lambda: admin
    return TestClient(app)


def test_admin_creates_an_invitation_without_choosing_password(monkeypatch) -> None:
    invited = {
        "id": 8,
        "email": "new@example.com",
        "name": "Nueva",
        "role": "vendedor",
        "is_active": False,
    }
    invite = AsyncMock(return_value=invited)
    monkeypatch.setattr(users, "invite_user", invite)

    response = _users_client().post(
        "/api/users",
        json={"email": "NEW@example.com", "name": "Nueva", "role": "vendedor"},
    )

    assert response.status_code == 201
    assert response.json() == invited
    invite.assert_awaited_once_with(
        email="new@example.com", name="Nueva", role="vendedor"
    )


def test_invitation_fails_closed_when_email_is_not_configured(monkeypatch) -> None:
    monkeypatch.setattr(
        users,
        "invite_user",
        AsyncMock(side_effect=EmailNotConfiguredError("not configured")),
    )

    response = _users_client().post(
        "/api/users",
        json={"email": "new@example.com", "name": "Nueva", "role": "vendedor"},
    )

    assert response.status_code == 503
    assert "configuración de correo" in response.json()["detail"]
