"""SMTP propio de cada negocio: validación, elección del transporte y red."""

from __future__ import annotations

import socket
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from app.integrations import email_service
from app.modules.platform import email_settings
from app.modules.platform.email_settings import EmailSettingsError, TenantMailConfig
from app.tenancy.context import TenantContext

CONTEXT = TenantContext(
    UUID("21675109-1111-2222-3333-444444444444"),
    "tenant_21675109111122223333444444444444",
    "acme.example.com",
)

VALID = dict(
    host="smtp.gmail.com",
    port=587,
    security="starttls",
    username="ventas@acme.com",
    password="app-password",
    from_address="Ventas@Acme.com",
    from_name="Acme",
)


class _Store:
    """Doble de los ajustes del negocio: guarda en memoria lo que escribiría."""

    def __init__(self, values: dict[str, str] | None = None) -> None:
        self.values = dict(values or {})

    async def get_many(self, keys):
        return {key: self.values.get(key, "") for key in keys}

    async def update(self, values):
        self.values.update(values)


@pytest.fixture
def store(monkeypatch) -> _Store:
    fake = _Store()
    monkeypatch.setattr(email_settings, "get_effective_many", fake.get_many)
    monkeypatch.setattr(email_settings, "update_settings", fake.update)
    return fake


async def test_saves_a_valid_smtp_and_never_returns_the_password(store) -> None:
    result = await email_settings.save_email_settings(**VALID)

    assert result["configured"] is True
    assert result["from_address"] == "ventas@acme.com"
    assert result["password_configured"] is True
    assert "password" not in result
    assert store.values["mail_smtp_password"] == "app-password"


@pytest.mark.parametrize(
    "host",
    ["localhost", "postgres", "127.0.0.1", "10.0.0.5", "169.254.169.254", "redis.internal", "x.localhost"],
)
async def test_rejects_internal_hosts(store, host) -> None:
    with pytest.raises(EmailSettingsError):
        await email_settings.save_email_settings(**(VALID | {"host": host}))


@pytest.mark.parametrize("port", [22, 5432, 6379, 8000])
async def test_rejects_ports_that_are_not_smtp(store, port) -> None:
    with pytest.raises(EmailSettingsError):
        await email_settings.save_email_settings(**(VALID | {"port": port}))


async def test_rejects_header_injection_in_sender_name(store) -> None:
    with pytest.raises(EmailSettingsError):
        await email_settings.save_email_settings(**(VALID | {"from_name": "Acme\r\nBcc: x@evil.com"}))


async def test_changing_host_requires_typing_the_password_again(store) -> None:
    await email_settings.save_email_settings(**VALID)

    with pytest.raises(EmailSettingsError):
        await email_settings.save_email_settings(
            **(VALID | {"host": "smtp.attacker.com", "password": None})
        )
    assert store.values["mail_smtp_host"] == "smtp.gmail.com"

    # Mismo servidor y usuario: la contraseña guardada se conserva.
    await email_settings.save_email_settings(**(VALID | {"from_name": "Otro", "password": None}))
    assert store.values["mail_smtp_password"] == "app-password"


async def test_clear_goes_back_to_the_platform(store) -> None:
    await email_settings.save_email_settings(**VALID)

    result = await email_settings.clear_email_settings()

    assert result["configured"] is False
    assert await email_settings.get_tenant_mail_config() is None


def _platform_env(monkeypatch) -> None:
    monkeypatch.setattr(email_service.settings, "email_provider", "smtp")
    monkeypatch.setattr(email_service.settings, "smtp_host", "smtp.platform.com")
    monkeypatch.setattr(email_service.settings, "smtp_ssl", False)
    monkeypatch.setattr(email_service.settings, "smtp_starttls", True)
    monkeypatch.setattr(email_service.settings, "email_from_address", "no-reply@platform.com")


async def test_tenant_smtp_wins_over_the_platform(monkeypatch) -> None:
    _platform_env(monkeypatch)
    config = TenantMailConfig("smtp.acme.com", 465, "ssl", "u", "p", "ventas@acme.com", "")

    async def tenant_config():
        return config

    monkeypatch.setattr(email_service, "get_current_tenant", lambda: CONTEXT)
    monkeypatch.setattr(email_service, "get_tenant_mail_oauth", AsyncMock(return_value=None))
    monkeypatch.setattr(email_service, "get_tenant_mail_config", tenant_config)

    transport = await email_service.resolve_transport()

    assert transport.source == "tenant"
    assert transport.host == "smtp.acme.com"
    assert transport.use_ssl is True and transport.starttls is False


async def test_without_tenant_smtp_the_platform_still_sends(monkeypatch) -> None:
    _platform_env(monkeypatch)

    async def no_config():
        return None

    monkeypatch.setattr(email_service, "get_current_tenant", lambda: CONTEXT)
    monkeypatch.setattr(email_service, "get_tenant_mail_oauth", AsyncMock(return_value=None))
    monkeypatch.setattr(email_service, "get_tenant_mail_config", no_config)

    transport = await email_service.resolve_transport()

    assert transport.source == "platform"
    assert transport.restricted is False


def test_tenant_host_resolving_to_a_private_ip_is_blocked(monkeypatch) -> None:
    # DNS que apunta a la red interna (o rebinding): no se conecta.
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("172.18.0.4", 587))],
    )

    with pytest.raises(email_service.EmailHostRejected):
        email_service._public_address("smtp.trampa.com", 587)


def test_tenant_connection_goes_to_the_validated_ip(monkeypatch) -> None:
    monkeypatch.setattr(
        socket,
        "getaddrinfo",
        lambda *a, **k: [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("142.250.0.108", 587))],
    )

    assert email_service._public_address("smtp.gmail.com", 587) == "142.250.0.108"
