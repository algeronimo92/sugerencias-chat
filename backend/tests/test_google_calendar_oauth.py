"""'Conectar con Google': el state firmado, el callback que guarda la
conexión en el negocio y la desconexión, con Google y los ajustes en memoria."""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlsplit
from uuid import uuid4

import pytest

from app.core.errors import Invalid
from app.integrations import google_calendar as google
from app.modules.platform import google_calendar_api as api
from app.modules.platform.google_oauth_state import (
    InvalidOAuthState,
    code_verifier,
    decode_state,
    issue_state,
)

ADMIN = SimpleNamespace(id=3, role="admin")
ORIGIN = "http://localhost:5173"


@pytest.fixture
def store(monkeypatch):
    values: dict[str, str] = {}

    async def get_effective(key):
        return values.get(key, "")

    async def get_effective_many(keys):
        return {key: values.get(key, "") for key in keys}

    async def update_settings(changes):
        values.update(changes)

    monkeypatch.setattr(api, "get_effective", get_effective)
    monkeypatch.setattr(api, "get_effective_many", get_effective_many)
    monkeypatch.setattr(api, "update_settings", update_settings)
    monkeypatch.setattr(api.settings, "multitenancy_enabled", False)
    monkeypatch.setattr(google, "platform_oauth_available", AsyncMock(return_value=True))
    return values


@pytest.fixture
def google_account(monkeypatch):
    exchange = AsyncMock(return_value="refresh-nuevo")
    calendars = AsyncMock(return_value=[
        {"id": "dueno@gmail.com", "summary": "Dueño", "primary": True},
        {"id": "agenda@group.calendar.google.com", "summary": "Agenda", "primary": False},
    ])
    monkeypatch.setattr(google, "exchange_code", exchange)
    monkeypatch.setattr(google, "list_calendars", calendars)
    return SimpleNamespace(exchange=exchange, calendars=calendars)


def _query(response) -> dict[str, str]:
    location = response.headers["location"]
    assert location.startswith(f"{ORIGIN}/?")
    return {key: value[0] for key, value in parse_qs(urlsplit(location).query).items()}


def _started_flow(store, nonce="nonce-1") -> str:
    store["google_calendar_oauth_nonce"] = nonce
    return issue_state(None, ADMIN.id, nonce, ORIGIN)


def test_state_roundtrip_keeps_its_claims():
    organization_id = uuid4()
    state = decode_state(issue_state(organization_id, 9, "n", ORIGIN))

    assert (state.organization_id, state.user_id, state.nonce, state.return_origin) == (
        organization_id, 9, "n", ORIGIN,
    )


def test_tampered_state_is_rejected():
    encoded, signature = issue_state(None, 9, "n", ORIGIN).split(".")

    with pytest.raises(InvalidOAuthState):
        decode_state(f"{encoded}x.{signature}")


def test_expired_state_is_rejected():
    token = issue_state(None, 9, "n", ORIGIN, now=datetime.now(timezone.utc) - timedelta(minutes=11))

    with pytest.raises(InvalidOAuthState):
        decode_state(token)


def test_pkce_verifier_meets_rfc_minimum():
    assert len(code_verifier("cualquier-nonce")) >= 43


async def test_callback_saves_connection_and_returns_to_crm(store, google_account):
    store["google_calendar_client_id"] = "cliente-manual"
    store["google_calendar_client_secret"] = "secreto-manual"

    response = await api.google_oauth_callback(state=_started_flow(store), code="codigo")

    assert response.status_code == 302
    assert _query(response) == {"settings": "calendar", "google": "connected"}
    google_account.exchange.assert_awaited_once_with("codigo", code_verifier("nonce-1"))
    assert store["google_calendar_refresh_token"] == "refresh-nuevo"
    assert store["google_calendar_account_email"] == "dueno@gmail.com"
    assert store["google_calendar_id"] == "dueno@gmail.com"
    assert store["google_calendar_enabled"] == "true"
    # El token nuevo es del cliente de la plataforma: las credenciales
    # manuales ganarían al renovarlo.
    assert store["google_calendar_client_id"] == store["google_calendar_client_secret"] == ""
    assert store["google_calendar_oauth_nonce"] == ""


async def test_callback_state_only_works_once(store, google_account):
    state = _started_flow(store)
    await api.google_oauth_callback(state=state, code="codigo")

    response = await api.google_oauth_callback(state=state, code="codigo")

    assert _query(response)["reason"] == "expired"
    assert google_account.exchange.await_count == 1


async def test_callback_reports_missing_refresh_token(store, google_account):
    google_account.exchange.side_effect = google.GoogleOAuthError("sin refresh", "no_refresh_token")

    response = await api.google_oauth_callback(state=_started_flow(store), code="codigo")

    assert _query(response) == {"settings": "calendar", "google": "error", "reason": "no_refresh_token"}
    assert "google_calendar_refresh_token" not in store


async def test_callback_reports_denied_consent(store, google_account):
    response = await api.google_oauth_callback(state=_started_flow(store), error="access_denied")

    assert _query(response)["reason"] == "denied"
    google_account.exchange.assert_not_awaited()


async def test_callback_without_valid_state_does_not_redirect(store):
    response = await api.google_oauth_callback(state="basura", code="codigo")

    assert response.status_code == 400


async def test_callback_resolves_the_organization_in_multitenant(store, google_account, monkeypatch):
    organization_id = uuid4()
    context = SimpleNamespace(organization_id=organization_id)
    monkeypatch.setattr(api.settings, "multitenancy_enabled", True)
    resolve = AsyncMock(return_value=context)
    monkeypatch.setattr(api, "resolve_tenant_by_organization_id", resolve)
    seen = []
    monkeypatch.setattr(api, "tenant_context", lambda ctx: _Recording(seen, ctx))
    store["google_calendar_oauth_nonce"] = "nonce-1"

    response = await api.google_oauth_callback(
        state=issue_state(organization_id, ADMIN.id, "nonce-1", ORIGIN), code="codigo",
    )

    resolve.assert_awaited_once_with(organization_id)
    assert seen == [context]
    assert _query(response)["google"] == "connected"


class _Recording:
    def __init__(self, seen, context):
        self.seen, self.context = seen, context

    def __enter__(self):
        self.seen.append(self.context)
        return self.context

    def __exit__(self, *_exc):
        return False


async def test_disconnect_clears_connection_even_if_revoke_fails(store, monkeypatch):
    store.update({
        "google_calendar_refresh_token": "refresh",
        "google_calendar_account_email": "dueno@gmail.com",
        "google_calendar_id": "dueno@gmail.com",
        "google_calendar_enabled": "true",
    })
    monkeypatch.setattr(google, "revoke", AsyncMock(return_value=False))

    status = await api.post_google_disconnect()

    assert status["connected"] is False
    assert status["enabled"] is False
    assert store["google_calendar_refresh_token"] == store["google_calendar_id"] == ""


async def test_selected_calendar_must_be_writable(store, google_account):
    store["google_calendar_refresh_token"] = "refresh"

    with pytest.raises(Invalid):
        await api.put_google_calendar(api.GoogleCalendarSelection(calendar_id="ajeno@gmail.com"))

    status = await api.put_google_calendar(
        api.GoogleCalendarSelection(calendar_id="agenda@group.calendar.google.com"),
    )
    assert status["calendar_id"] == "agenda@group.calendar.google.com"
    assert status["enabled"] is True


async def test_authorize_rejects_a_foreign_return_origin(store, monkeypatch):
    monkeypatch.setattr(google, "platform_oauth_config", AsyncMock(return_value={
        "google_oauth_client_id": "id", "google_oauth_client_secret": "s",
        "google_oauth_redirect_uri": "http://localhost:8000/api/integrations/google/callback",
    }))
    request = SimpleNamespace(headers={"host": "localhost:8000"})

    with pytest.raises(Invalid):
        await api.post_google_authorize(
            api.GoogleAuthorizeRequest(return_origin="https://evil.example"), request, ADMIN,
        )

    result = await api.post_google_authorize(api.GoogleAuthorizeRequest(return_origin=ORIGIN), request, ADMIN)
    assert result["url"].startswith(google.GOOGLE_AUTH_URL)
    assert store["google_calendar_oauth_nonce"]


async def test_own_oauth_client_wins_over_platform(monkeypatch):
    monkeypatch.setattr(google, "platform_settings_many", AsyncMock(return_value={
        "google_oauth_client_id": "plataforma", "google_oauth_client_secret": "s-plataforma",
    }))

    assert await google.oauth_client({
        "google_calendar_client_id": "propio", "google_calendar_client_secret": "s-propio",
    }) == ("propio", "s-propio")
    assert await google.oauth_client({}) == ("plataforma", "s-plataforma")


class _Response:
    def __init__(self, status_code, payload):
        self.status_code = status_code
        self.is_error = status_code >= 400
        self._payload = payload

    def json(self):
        return self._payload


async def test_revoked_authorization_asks_to_reconnect():
    client = SimpleNamespace(post=AsyncMock(return_value=_Response(400, {"error": "invalid_grant"})))

    with pytest.raises(google.GoogleOAuthError) as exc:
        await google._access_token(client, "id", "secret", "refresh")

    assert exc.value.code == "reconnect"
    assert "reconecta" in str(exc.value)
