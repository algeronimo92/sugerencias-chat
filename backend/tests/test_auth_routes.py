"""Contrato HTTP del login persistente y el acceso rápido."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from routers import auth, platform
from services.session_service import CreatedSession, PinLockedError, TrustedDeviceResult, new_token
from services.login_throttle import LoginThrottledError


@pytest.fixture(autouse=True)
def isolated_login_security(monkeypatch):
    monkeypatch.setattr(auth, "reserve_login_attempt", AsyncMock())
    monkeypatch.setattr(auth, "clear_account_attempts", AsyncMock())
    monkeypatch.setattr(auth, "mfa_status", AsyncMock(return_value={"enabled": False, "recovery_codes_remaining": 0}))


def _user():
    return SimpleNamespace(
        id=7,
        email="vendedor@example.com",
        name="Vendedor",
        role="vendedor",
        is_active=True,
        password_hash="hash",
    )


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(auth.router)
    return TestClient(app)


def test_password_login_creates_persistent_session_and_trusted_device(monkeypatch) -> None:
    now = datetime.now(timezone.utc)
    device_token = new_token()
    session_token = new_token()
    monkeypatch.setattr(auth, "get_user_by_email", AsyncMock(return_value=_user()))
    monkeypatch.setattr(auth, "verify_password", lambda password, password_hash: True)
    register = AsyncMock(return_value=TrustedDeviceResult("device-id", device_token, now + timedelta(days=90)))
    create = AsyncMock(return_value=CreatedSession(session_token, "session-id", now + timedelta(days=90), True))
    monkeypatch.setattr(auth, "register_trusted_device", register)
    monkeypatch.setattr(auth, "create_session", create)

    response = _client().post(
        "/api/auth/login",
        json={"email": "VENDEDOR@example.com", "password": "secret", "remember_device": True},
        headers={"user-agent": "Mozilla/5.0 (Linux; Android 15) Chrome/140.0"},
    )

    assert response.status_code == 200
    assert response.cookies["access_token"] == session_token
    assert response.cookies["trusted_device"] == device_token
    assert "HttpOnly" in response.headers["set-cookie"]
    assert "SameSite=lax" in response.headers["set-cookie"]
    register.assert_awaited_once()
    assert create.await_args.kwargs["trusted_device_id"] == "device-id"


def test_password_login_without_remembering_uses_browser_session_only(monkeypatch) -> None:
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(auth, "get_user_by_email", AsyncMock(return_value=_user()))
    monkeypatch.setattr(auth, "verify_password", lambda password, password_hash: True)
    register = AsyncMock()
    forget = AsyncMock(return_value=True)
    create = AsyncMock(return_value=CreatedSession(new_token(), "session-id", now + timedelta(hours=24), False))
    monkeypatch.setattr(auth, "register_trusted_device", register)
    monkeypatch.setattr(auth, "forget_trusted_device", forget)
    monkeypatch.setattr(auth, "create_session", create)
    old_device_token = new_token()

    response = _client().post(
        "/api/auth/login",
        json={"email": "vendedor@example.com", "password": "secret", "remember_device": False},
        headers={"cookie": f"trusted_device={old_device_token}"},
    )

    assert response.status_code == 200
    assert response.cookies.get("trusted_device") is None
    assert "trusted_device=\"\"" in response.headers["set-cookie"]
    assert response.cookies.get("access_token")
    session_cookie = next(cookie for cookie in response.cookies.jar if cookie.name == "access_token")
    assert session_cookie.expires is None
    register.assert_not_awaited()
    forget.assert_awaited_once_with(7, old_device_token)
    assert create.await_args.kwargs["persistent"] is False


def test_password_login_throttle_precedes_password_lookup(monkeypatch) -> None:
    lookup = AsyncMock()
    monkeypatch.setattr(auth, "get_user_by_email", lookup)
    auth.reserve_login_attempt.side_effect = LoginThrottledError(900)

    response = _client().post(
        "/api/auth/login",
        json={"email": "Vendedor@example.com", "password": "wrong"},
    )

    assert response.status_code == 429
    assert response.headers["retry-after"] == "900"
    lookup.assert_not_awaited()


def test_platform_login_is_limited_before_authentication(monkeypatch) -> None:
    reserve = AsyncMock(side_effect=LoginThrottledError(900))
    authenticate = AsyncMock()
    monkeypatch.setattr(platform, "reserve_login_attempt", reserve)
    monkeypatch.setattr(platform, "authenticate", authenticate)
    app = FastAPI()
    app.include_router(platform.router)

    response = TestClient(app).post(
        "/api/platform/auth/login", json={"email": "operator@example.com", "password": "wrong"}
    )

    assert response.status_code == 429
    assert response.headers["retry-after"] == "900"
    authenticate.assert_not_awaited()


def test_admin_login_requires_second_factor_before_creating_session(monkeypatch) -> None:
    admin = _user()
    admin.role = "admin"
    monkeypatch.setattr(auth, "get_user_by_email", AsyncMock(return_value=admin))
    monkeypatch.setattr(auth, "verify_password", lambda *_args: True)
    auth.mfa_status.return_value = {"enabled": True, "recovery_codes_remaining": 8}
    create = AsyncMock()
    register = AsyncMock()
    monkeypatch.setattr(auth, "create_session", create)
    monkeypatch.setattr(auth, "register_trusted_device", register)

    response = _client().post(
        "/api/auth/login",
        json={"email": admin.email, "password": "secret", "remember_device": True},
    )

    assert response.status_code == 403
    assert "access_token" not in response.cookies
    create.assert_not_awaited()
    register.assert_not_awaited()
    auth.clear_account_attempts.assert_not_awaited()


def test_admin_pin_does_not_bypass_second_factor(monkeypatch) -> None:
    admin = _user()
    admin.role = "admin"
    trusted = SimpleNamespace(token=new_token(), expires_at=datetime.now(timezone.utc) + timedelta(days=1), device_id="device")
    monkeypatch.setattr(auth, "authenticate_pin", AsyncMock(return_value=(admin, trusted)))
    auth.mfa_status.return_value = {"enabled": True, "recovery_codes_remaining": 8}
    create = AsyncMock()
    monkeypatch.setattr(auth, "create_session", create)

    response = _client().post("/api/auth/pin/login", json={"pin": "1234"})

    assert response.status_code == 403
    create.assert_not_awaited()


def test_admin_login_with_valid_code_creates_session_after_verification(monkeypatch) -> None:
    admin = _user()
    admin.role = "admin"
    monkeypatch.setattr(auth, "get_user_by_email", AsyncMock(return_value=admin))
    monkeypatch.setattr(auth, "verify_password", lambda *_args: True)
    auth.mfa_status.return_value = {"enabled": True, "recovery_codes_remaining": 8}
    verify = AsyncMock(return_value=True)
    monkeypatch.setattr(auth, "verify_mfa", verify)
    now = datetime.now(timezone.utc)
    create = AsyncMock(return_value=CreatedSession(new_token(), "session-id", now + timedelta(hours=24), False))
    monkeypatch.setattr(auth, "create_session", create)

    response = _client().post(
        "/api/auth/login",
        json={"email": admin.email, "password": "secret", "remember_device": False, "mfa_code": "123456"},
    )

    assert response.status_code == 200
    verify.assert_awaited_once_with(admin.id, "123456")
    create.assert_awaited_once()
    auth.clear_account_attempts.assert_awaited_once_with(admin.email)


def test_admin_mfa_login_does_not_create_a_pin_trusted_device(monkeypatch) -> None:
    admin = _user()
    admin.role = "admin"
    monkeypatch.setattr(auth, "get_user_by_email", AsyncMock(return_value=admin))
    monkeypatch.setattr(auth, "verify_password", lambda *_args: True)
    auth.mfa_status.return_value = {"enabled": True, "recovery_codes_remaining": 8}
    monkeypatch.setattr(auth, "verify_mfa", AsyncMock(return_value=True))
    register = AsyncMock()
    monkeypatch.setattr(auth, "register_trusted_device", register)
    now = datetime.now(timezone.utc)
    monkeypatch.setattr(auth, "create_session", AsyncMock(return_value=CreatedSession(new_token(), "session-id", now + timedelta(days=90), True)))

    response = _client().post(
        "/api/auth/login",
        json={"email": admin.email, "password": "secret", "remember_device": True, "mfa_code": "123456"},
    )

    assert response.status_code == 200
    register.assert_not_awaited()
    assert "trusted_device" not in response.cookies


def test_activating_mfa_revokes_preexisting_sessions_and_pin_devices(monkeypatch) -> None:
    admin = _user()
    admin.role = "admin"
    app = FastAPI()
    app.include_router(auth.router)
    app.dependency_overrides[auth.get_current_user] = lambda: admin
    monkeypatch.setattr(auth, "confirm_enrollment", AsyncMock(return_value=["AAAAA-BBBBB-CCCCC-DDDDD"]))
    revoke = AsyncMock()
    monkeypatch.setattr(auth, "revoke_all_for_user", revoke)

    response = TestClient(app).post("/api/auth/mfa/confirm", json={"code": "123456"})

    assert response.status_code == 200
    assert response.json()["recovery_codes"] == ["AAAAA-BBBBB-CCCCC-DDDDD"]
    revoke.assert_awaited_once_with(admin.id, include_devices=True)
    assert 'access_token=""' in response.headers["set-cookie"]


def test_pin_status_is_public_but_only_uses_http_only_device_cookie(monkeypatch) -> None:
    status = {
        "available": True,
        "user_name": "Vendedor",
        "masked_email": "ve***@example.com",
        "device_name": "Chrome en Android",
        "locked_seconds": 0,
    }
    lookup = AsyncMock(return_value=status)
    monkeypatch.setattr(auth, "pin_status", lookup)
    device_token = new_token()

    response = _client().get(
        "/api/auth/pin/status",
        headers={"cookie": f"trusted_device={device_token}"},
    )

    assert response.status_code == 200
    assert response.json() == status
    lookup.assert_awaited_once_with(device_token)


def test_setup_pin_rejects_a_wrong_length_value_before_storage(monkeypatch) -> None:
    app = FastAPI()
    app.include_router(auth.router)
    app.dependency_overrides[auth.get_current_user] = _user
    configure = AsyncMock()
    monkeypatch.setattr(auth, "configure_pin", configure)

    response = TestClient(app).post(
        "/api/auth/pin/setup",
        json={"pin": "123", "current_password": "secret"},
    )

    assert response.status_code == 400
    configure.assert_not_awaited()


def test_pin_lock_returns_retry_after_without_creating_session(monkeypatch) -> None:
    authenticate = AsyncMock(side_effect=PinLockedError(900))
    create = AsyncMock()
    monkeypatch.setattr(auth, "authenticate_pin", authenticate)
    monkeypatch.setattr(auth, "create_session", create)

    response = _client().post(
        "/api/auth/pin/login",
        json={"pin": "123456"},
        headers={"cookie": f"trusted_device={new_token()}"},
    )

    assert response.status_code == 423
    assert response.headers["retry-after"] == "900"
    create.assert_not_awaited()


def test_regular_logout_revokes_session_but_preserves_pin_device(monkeypatch) -> None:
    revoke = AsyncMock()
    monkeypatch.setattr(auth, "revoke_session_token", revoke)
    session_token = new_token()
    device_token = new_token()

    response = _client().post(
        "/api/auth/logout",
        headers={"cookie": f"access_token={session_token}; trusted_device={device_token}"},
    )

    assert response.status_code == 200
    revoke.assert_awaited_once_with(session_token)
    assert "access_token=\"\"" in response.headers["set-cookie"]
    assert "trusted_device=\"\"" not in response.headers["set-cookie"]


def test_logout_all_revokes_sessions_and_pin_devices(monkeypatch) -> None:
    app = FastAPI()
    app.include_router(auth.router)
    app.dependency_overrides[auth.get_current_user] = _user
    revoke_all = AsyncMock()
    monkeypatch.setattr(auth, "revoke_all_for_user", revoke_all)

    response = TestClient(app).post("/api/auth/logout-all")

    assert response.status_code == 200
    revoke_all.assert_awaited_once_with(7, include_devices=True)
    set_cookie = response.headers["set-cookie"]
    assert "access_token=\"\"" in set_cookie
    assert "trusted_device=\"\"" in set_cookie
