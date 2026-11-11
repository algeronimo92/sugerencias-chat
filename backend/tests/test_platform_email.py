"""Correo de envío de la plataforma, editable desde el panel."""

from __future__ import annotations

from unittest.mock import AsyncMock

import pytest

from app.integrations import email_service
from app.modules.platform import platform_email, platform_settings
from app.modules.platform.email_settings import EmailSettingsError

VALID = dict(
    host="smtp.hostinger.com",
    port=465,
    security="ssl",
    username="no-reply@cliniventas.com",
    password="secret",
    from_address="No-Reply@CliniVentas.com",
    from_name="CliniVentas",
)


class _Store:
    """Doble de ``platform_settings``: guarda en memoria lo que escribiría."""

    def __init__(self) -> None:
        self.values: dict[str, str] = {}
        self.include_hidden: list[bool] = []

    async def many(self, keys):
        return {key: self.values.get(key, "") for key in keys}

    async def update(self, values, *, include_hidden=False):
        self.include_hidden.append(include_hidden)
        self.values.update(values)


@pytest.fixture
def store(monkeypatch) -> _Store:
    fake = _Store()
    monkeypatch.setattr(platform_email, "platform_settings_many", fake.many)
    monkeypatch.setattr(platform_email, "update_platform_settings", fake.update)
    return fake


def _no_environment(monkeypatch) -> None:
    monkeypatch.setattr(platform_email.settings, "smtp_host", "")


def _environment(monkeypatch) -> None:
    monkeypatch.setattr(platform_email.settings, "email_provider", "smtp")
    monkeypatch.setattr(platform_email.settings, "smtp_host", "smtp.env.com")
    monkeypatch.setattr(platform_email.settings, "smtp_port", 587)
    monkeypatch.setattr(platform_email.settings, "smtp_ssl", False)
    monkeypatch.setattr(platform_email.settings, "smtp_starttls", True)
    monkeypatch.setattr(platform_email.settings, "smtp_username", "env-user")
    monkeypatch.setattr(platform_email.settings, "smtp_password", "env-password")
    monkeypatch.setattr(platform_email.settings, "email_from_address", "env@cliniventas.com")


async def test_saves_the_platform_smtp_and_never_returns_the_password(store, monkeypatch) -> None:
    _no_environment(monkeypatch)

    result = await platform_email.save_platform_email(**VALID)

    assert result["source"] == "platform"
    assert result["from_address"] == "no-reply@cliniventas.com"
    assert result["password_configured"] is True
    assert "password" not in result
    assert store.values["platform_smtp_password"] == "secret"
    assert store.include_hidden == [True]


async def test_the_panel_smtp_wins_over_the_environment_as_a_whole(store, monkeypatch) -> None:
    _environment(monkeypatch)
    await platform_email.save_platform_email(**(VALID | {"username": "", "password": None}))
    monkeypatch.setattr(email_service, "get_platform_mail_config", platform_email.get_platform_mail_config)

    transport = await email_service.platform_transport()

    assert transport.host == "smtp.hostinger.com"
    assert transport.use_ssl is True and transport.starttls is False
    # Nunca se mezcla con las credenciales del .env.
    assert transport.username == "" and transport.password == ""
    assert transport.restricted is False


async def test_clearing_the_panel_falls_back_to_the_environment(store, monkeypatch) -> None:
    _environment(monkeypatch)
    await platform_email.save_platform_email(**VALID)

    result = await platform_email.clear_platform_email()

    assert result["source"] == "environment"
    assert result["environment_host"] == "smtp.env.com"
    monkeypatch.setattr(email_service, "get_platform_mail_config", platform_email.get_platform_mail_config)
    transport = await email_service.platform_transport()
    assert transport.host == "smtp.env.com"
    assert transport.password == "env-password"


async def test_without_panel_nor_environment_there_is_no_platform_mail(store, monkeypatch) -> None:
    _no_environment(monkeypatch)
    monkeypatch.setattr(email_service, "get_platform_mail_config", platform_email.get_platform_mail_config)

    assert (await platform_email.read_platform_email())["source"] is None
    assert await email_service.platform_transport() is None


async def test_an_internal_relay_is_allowed(store, monkeypatch) -> None:
    _no_environment(monkeypatch)

    result = await platform_email.save_platform_email(**(VALID | {"host": "postfix", "port": 25}))

    assert result["host"] == "postfix"
    assert result["port"] == 25


async def test_changing_the_server_requires_the_password_again(store, monkeypatch) -> None:
    _no_environment(monkeypatch)
    await platform_email.save_platform_email(**VALID)

    with pytest.raises(EmailSettingsError):
        await platform_email.save_platform_email(**(VALID | {"host": "smtp.other.com", "password": None}))


@pytest.mark.parametrize(
    "override",
    [
        {"host": "smtp host"},
        {"security": "none"},
        {"from_address": "no-es-un-correo"},
        {"from_name": "Cliniventas\r\nBcc: x@y.com"},
    ],
)
async def test_rejects_invalid_values(store, monkeypatch, override) -> None:
    _no_environment(monkeypatch)

    with pytest.raises(EmailSettingsError):
        await platform_email.save_platform_email(**(VALID | override))


async def test_the_generic_credentials_form_neither_lists_nor_saves_mail_keys(monkeypatch) -> None:
    platform_settings.invalidate_platform_settings_cache()
    monkeypatch.setattr(platform_settings, "_raw_database_values", AsyncMock(return_value={}))
    monkeypatch.setattr(platform_settings, "_legacy_single_tenant_values", AsyncMock(return_value={}))
    try:
        listed = {item["key"] for item in await platform_settings.list_platform_settings()}
        assert not listed & set(platform_email.KEYS)
        with pytest.raises(ValueError):
            await platform_settings.update_platform_settings({"platform_smtp_host": "evil.example.com"})
    finally:
        platform_settings.invalidate_platform_settings_cache()
