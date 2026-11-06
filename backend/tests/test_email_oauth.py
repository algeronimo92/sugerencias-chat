"""'Conectar con…' del correo: URLs de autorización, callback y envío por API."""

from __future__ import annotations

import base64
import json
from email.message import EmailMessage
from unittest.mock import AsyncMock
from urllib.parse import parse_qs, urlsplit
from uuid import UUID

import httpx
from fastapi import FastAPI
from fastapi.testclient import TestClient
import pytest

from app.integrations import email_oauth, email_service
from app.integrations.email_oauth import Connection, EmailOAuthError, OAuthClient
from app.modules.platform import email_settings, email_settings_api
from app.modules.platform.email_settings import TenantMailOAuth
from app.modules.platform.google_oauth_state import issue_state
from app.tenancy.context import TenantContext

CLIENT = OAuthClient("client-id", "client-secret", "https://admin.cliniventas.com/api/integrations/email/callback")
CONTEXT = TenantContext(
    UUID("21675109-1111-2222-3333-444444444444"),
    "tenant_21675109111122223333444444444444",
    "acme.example.com",
)


def _query(url: str) -> dict[str, str]:
    return {key: values[0] for key, values in parse_qs(urlsplit(url).query).items()}


def _id_token(claims: dict) -> str:
    body = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    return f"header.{body}.signature"


@pytest.mark.parametrize("provider", ["google", "microsoft"])
def test_google_and_microsoft_ask_only_for_sending_with_pkce(provider) -> None:
    query = _query(email_oauth.authorization_url(provider, CLIENT, state="s", code_challenge="c"))

    assert query["redirect_uri"] == CLIENT.redirect_uri
    assert query["code_challenge"] == "c" and query["code_challenge_method"] == "S256"
    assert "gmail.send" in query["scope"] or "Mail.Send" in query["scope"]
    # Nunca lectura del buzón: solo enviar.
    assert "readonly" not in query["scope"] and "Mail.Read" not in query["scope"]


def test_zoho_asks_for_offline_access_to_send() -> None:
    url = email_oauth.authorization_url("zoho", CLIENT, state="s", code_challenge="c")

    assert url.startswith("https://accounts.zoho.com/oauth/v2/auth?")
    query = _query(url)
    assert query["access_type"] == "offline"
    assert query["scope"] == "ZohoMail.messages.CREATE,ZohoMail.accounts.READ"


def test_zoho_data_center_must_be_a_known_one() -> None:
    assert email_oauth.zoho_accounts_server("https://accounts.zoho.eu/") == "https://accounts.zoho.eu"
    # El client secret de la plataforma viaja a este servidor.
    with pytest.raises(EmailOAuthError):
        email_oauth.zoho_accounts_server("https://accounts.zoho.evil.com")


def test_account_email_comes_from_the_id_token() -> None:
    assert email_oauth._id_token_email(_id_token({"email": "Ventas@Acme.com"})) == "ventas@acme.com"
    assert email_oauth._id_token_email(_id_token({"preferred_username": "a@b.com"})) == "a@b.com"
    assert email_oauth._id_token_email("not-a-token") == ""


def _mock_http(monkeypatch, handler) -> list[httpx.Request]:
    seen: list[httpx.Request] = []

    def recording(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return handler(request)

    real_client = httpx.AsyncClient
    monkeypatch.setattr(
        email_oauth.httpx,
        "AsyncClient",
        lambda **kwargs: real_client(transport=httpx.MockTransport(recording), **kwargs),
    )
    return seen


async def test_microsoft_send_stores_the_rotated_refresh_token(monkeypatch) -> None:
    monkeypatch.setattr(email_oauth, "oauth_client", AsyncMock(return_value=CLIENT))

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/token"):
            return httpx.Response(200, json={"access_token": "at", "refresh_token": "nuevo"})
        assert request.url.host == "graph.microsoft.com"
        assert request.headers["Authorization"] == "Bearer at"
        return httpx.Response(202)

    seen = _mock_http(monkeypatch, handler)
    message = EmailMessage()
    message["Subject"] = "Hola"
    message.set_content("x")

    rotated = await email_oauth.send_message(
        Connection("microsoft", "viejo", "ventas@acme.com"),
        message,
        recipients=["a@b.com"],
        subject="Hola",
        html_body="<p>x</p>",
    )

    assert rotated == "nuevo"
    assert len(seen) == 2


async def test_revoked_authorization_asks_to_reconnect(monkeypatch) -> None:
    monkeypatch.setattr(email_oauth, "oauth_client", AsyncMock(return_value=CLIENT))
    _mock_http(monkeypatch, lambda request: httpx.Response(400, json={"error": "invalid_grant"}))

    with pytest.raises(EmailOAuthError) as caught:
        await email_oauth.send_message(
            Connection("google", "rt", "ventas@acme.com"),
            EmailMessage(),
            recipients=["a@b.com"],
            subject="s",
            html_body="",
        )

    assert caught.value.code == "reconnect"
    assert "Configuración → Correo" in str(caught.value)


async def test_zoho_connection_reads_the_mailbox_in_its_data_center(monkeypatch) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "accounts.zoho.eu":
            return httpx.Response(200, json={"access_token": "at", "refresh_token": "rt"})
        assert request.url.host == "mail.zoho.eu"
        return httpx.Response(200, json={"data": [{"accountId": "123", "primaryEmailAddress": "Ventas@Acme.com"}]})

    _mock_http(monkeypatch, handler)

    connection = await email_oauth.complete_authorization(
        "zoho", CLIENT, code="code", code_verifier="v", accounts_server="https://accounts.zoho.eu"
    )

    assert connection == Connection("zoho", "rt", "ventas@acme.com", "https://accounts.zoho.eu", "123")


async def test_connected_account_wins_over_smtp_and_platform(monkeypatch) -> None:
    monkeypatch.setattr(email_service, "get_current_tenant", lambda: CONTEXT)
    monkeypatch.setattr(
        email_service,
        "get_tenant_mail_oauth",
        AsyncMock(return_value=TenantMailOAuth("google", "rt", "ventas@acme.com", "", "")),
    )

    transport = await email_service.resolve_transport()

    assert isinstance(transport, email_service.OAuthTransport)
    assert transport.connection.account_email == "ventas@acme.com"


def _callback_client() -> TestClient:
    app = FastAPI()
    app.include_router(email_settings_api.callback_router)
    return TestClient(app, follow_redirects=False)


def test_callback_stores_the_connection_and_returns_to_the_crm(monkeypatch) -> None:
    monkeypatch.setattr(email_settings_api.settings, "multitenancy_enabled", False)
    monkeypatch.setattr(email_settings_api, "consume_oauth_nonce", AsyncMock(return_value="google"))
    monkeypatch.setattr(email_settings_api.email_oauth, "oauth_client", AsyncMock(return_value=CLIENT))
    monkeypatch.setattr(
        email_settings_api.email_oauth,
        "complete_authorization",
        AsyncMock(return_value=Connection("google", "rt", "ventas@acme.com")),
    )
    store = AsyncMock()
    monkeypatch.setattr(email_settings_api, "store_oauth_connection", store)
    state = issue_state(None, 1, "nonce", "https://acme.example.com")

    response = _callback_client().get(email_settings_api.CALLBACK_PATH, params={"state": state, "code": "c"})

    assert response.status_code == 302
    assert response.headers["location"] == "https://acme.example.com/?settings=email&email=connected&provider=google"
    store.assert_awaited_once()


def test_callback_with_a_used_nonce_does_not_connect(monkeypatch) -> None:
    monkeypatch.setattr(email_settings_api.settings, "multitenancy_enabled", False)
    monkeypatch.setattr(email_settings_api, "consume_oauth_nonce", AsyncMock(return_value=None))
    complete = AsyncMock()
    monkeypatch.setattr(email_settings_api.email_oauth, "complete_authorization", complete)
    state = issue_state(None, 1, "nonce", "https://acme.example.com")

    response = _callback_client().get(email_settings_api.CALLBACK_PATH, params={"state": state, "code": "c"})

    assert "reason=expired" in response.headers["location"]
    complete.assert_not_awaited()


def test_callback_without_a_valid_state_does_not_redirect() -> None:
    response = _callback_client().get(email_settings_api.CALLBACK_PATH, params={"state": "falso", "code": "c"})

    assert response.status_code == 400


class _Store:
    def __init__(self) -> None:
        self.values: dict[str, str] = {}

    async def get_many(self, keys):
        return {key: self.values.get(key, "") for key in keys}

    async def update(self, values):
        self.values.update(values)


async def test_connecting_an_account_and_saving_smtp_exclude_each_other(monkeypatch) -> None:
    store = _Store()
    monkeypatch.setattr(email_settings, "get_effective_many", store.get_many)
    monkeypatch.setattr(email_settings, "update_settings", store.update)

    await email_settings.save_email_settings(
        host="smtp.hostinger.com", port=465, security="ssl", username="a@acme.com",
        password="p", from_address="a@acme.com", from_name="",
    )
    await email_settings.store_oauth_connection(provider="zoho", refresh_token="rt", account_email="a@acme.com")

    status = await email_settings.read_email_settings()
    assert status["mode"] == "oauth" and status["oauth_provider"] == "zoho"
    assert store.values["mail_smtp_password"] == ""

    await email_settings.save_email_settings(
        host="smtp.hostinger.com", port=465, security="ssl", username="a@acme.com",
        password="p", from_address="a@acme.com", from_name="",
    )
    assert (await email_settings.read_email_settings())["mode"] == "smtp"
    assert store.values["mail_oauth_refresh_token"] == ""


async def test_oauth_nonce_is_single_use(monkeypatch) -> None:
    store = _Store()
    monkeypatch.setattr(email_settings, "get_effective_many", store.get_many)
    monkeypatch.setattr(email_settings, "update_settings", store.update)

    await email_settings.start_oauth("microsoft", "n1")

    assert await email_settings.consume_oauth_nonce("otro") is None
    assert await email_settings.consume_oauth_nonce("n1") == "microsoft"
    assert await email_settings.consume_oauth_nonce("n1") is None
