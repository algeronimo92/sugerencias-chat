import base64
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from app.core import secret_cipher
from app.modules.platform import settings_service


@pytest.fixture(autouse=True)
def empty_settings_cache():
    settings_service.invalidate_settings_cache()
    yield
    settings_service.invalidate_settings_cache()


@pytest.mark.asyncio
async def test_effective_settings_are_loaded_once_and_reused(monkeypatch):
    load_values = AsyncMock(return_value={
        "elevenlabs_voice_id": "voice-1",
        "n8n_citas_webhook_url": "https://n8n.test/citas",
    })
    monkeypatch.setattr(settings_service, "_db_values", load_values)
    monkeypatch.setattr(
        settings_service,
        "_env_default",
        lambda key: "secret-from-env" if key == "elevenlabs_api_key" else "",
    )

    first = await settings_service.get_effective_many((
        "elevenlabs_voice_id", "elevenlabs_api_key", "n8n_citas_webhook_url",
    ))
    second = await settings_service.get_effective("elevenlabs_voice_id")

    assert first == {
        "elevenlabs_voice_id": "voice-1",
        "elevenlabs_api_key": "secret-from-env",
        "n8n_citas_webhook_url": "https://n8n.test/citas",
    }
    assert second == "voice-1"
    load_values.assert_awaited_once_with()


@pytest.mark.asyncio
async def test_invalidating_cache_forces_a_reload(monkeypatch):
    load_values = AsyncMock(side_effect=[
        {"n8n_citas_webhook_url": "first"},
        {"n8n_citas_webhook_url": "second"},
    ])
    monkeypatch.setattr(settings_service, "_db_values", load_values)

    assert await settings_service.get_effective("n8n_citas_webhook_url") == "first"
    settings_service.invalidate_settings_cache()
    assert await settings_service.get_effective("n8n_citas_webhook_url") == "second"
    assert load_values.await_count == 2


@pytest.mark.asyncio
async def test_updating_secret_setting_never_persists_plaintext(monkeypatch):
    statements = []

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def execute(self, statement):
            statements.append(statement)

        async def commit(self):
            return None

    monkeypatch.setattr(settings_service.settings_repository, "get_sessionmaker", lambda: FakeSession)
    monkeypatch.setattr(
        secret_cipher.settings,
        "settings_encryption_key",
        base64.urlsafe_b64encode(b"s" * 32).decode("ascii"),
    )

    await settings_service.update_settings({"elevenlabs_api_key": "plain-secret"})

    params = statements[0].compile().params
    serialized_params = " ".join(str(value) for value in params.values())
    assert "plain-secret" not in serialized_params
    assert secret_cipher.ENCRYPTED_PREFIX in serialized_params


@pytest.mark.asyncio
async def test_updating_public_setting_persists_usable_plaintext(monkeypatch):
    statements = []

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def execute(self, statement):
            statements.append(statement)

        async def commit(self):
            return None

    monkeypatch.setattr(settings_service.settings_repository, "get_sessionmaker", lambda: FakeSession)

    public_url = "https://n8n.example.test/citas"
    await settings_service.update_settings({"n8n_citas_webhook_url": public_url})

    params = statements[0].compile().params
    serialized_params = " ".join(str(value) for value in params.values())
    assert public_url in serialized_params
    assert secret_cipher.ENCRYPTED_PREFIX not in serialized_params


@pytest.mark.asyncio
async def test_migration_encrypts_secrets_and_restores_public_plaintext(monkeypatch):
    statements = []

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def execute(self, statement):
            statements.append(statement)

        async def commit(self):
            return None

    monkeypatch.setattr(settings_service.settings_repository, "get_sessionmaker", lambda: FakeSession)
    monkeypatch.setattr(
        secret_cipher.settings,
        "settings_encryption_key",
        base64.urlsafe_b64encode(b"s" * 32).decode("ascii"),
    )
    public_url = "https://n8n.example.test/citas"
    encrypted_public_url = secret_cipher.encrypt_secret(
        "n8n_citas_webhook_url", public_url
    )
    monkeypatch.setattr(
        settings_service,
        "_raw_db_values",
        AsyncMock(return_value={
            "n8n_citas_webhook_url": encrypted_public_url,
            "elevenlabs_api_key": "legacy-plaintext-token",
            "an_old_removed_key": "already-plain",
        }),
    )

    assert await settings_service.migrate_settings_encryption() == (1, 1)

    serialized_statements = [
        " ".join(str(value) for value in statement.compile().params.values())
        for statement in statements
    ]
    serialized = " ".join(serialized_statements)
    assert public_url in serialized
    assert "legacy-plaintext-token" not in serialized
    assert sum(secret_cipher.ENCRYPTED_PREFIX in item for item in serialized_statements) == 1


@pytest.mark.asyncio
async def test_secret_values_are_never_returned_by_settings_api_model(monkeypatch):
    monkeypatch.setattr(settings_service, "_db_values", AsyncMock(return_value={
        "elevenlabs_voice_id": "voice-1",
        "elevenlabs_api_key": "decrypted-in-backend-only",
    }))
    monkeypatch.setattr(settings_service, "_env_default", lambda _key: "")

    items = {item["key"]: item for item in await settings_service.list_settings()}

    assert items["elevenlabs_voice_id"]["value"] == "voice-1"
    assert items["elevenlabs_api_key"]["configured"] is True
    assert items["elevenlabs_api_key"]["value"] is None


@pytest.mark.asyncio
async def test_tenant_settings_exclude_platform_credentials(monkeypatch):
    monkeypatch.setattr(settings_service, "_db_values", AsyncMock(return_value={}))
    monkeypatch.setattr(settings_service, "_env_default", lambda _key: "")

    keys = {item["key"] for item in await settings_service.list_settings()}

    assert {"meta_access_token", "meta_waba_id", "meta_phone_number_id"} <= keys
    assert {
        "meta_app_id",
        "meta_app_secret",
        "meta_verify_token",
        "inbound_webhook_token",
        "n8n_webhook_url",
        "n8n_analyst_webhook_url",
        "n8n_webhook_token",
    }.isdisjoint(keys)


@pytest.mark.asyncio
async def test_platform_managed_integrations_are_hidden_from_the_tenant(monkeypatch):
    monkeypatch.setattr(settings_service, "_db_values", AsyncMock(return_value={
        "n8n_citas_webhook_url": "https://n8n.test/citas",
    }))
    monkeypatch.setattr(settings_service, "_env_default", lambda _key: "")

    keys = {item["key"] for item in await settings_service.list_settings()}

    assert keys.isdisjoint(settings_service.PLATFORM_MANAGED_TENANT_KEYS)
    # Siguen resolviéndose para el negocio: lo oculto es la configuración.
    assert await settings_service.get_effective("n8n_citas_webhook_url") == "https://n8n.test/citas"


def test_ai_workflow_settings_belong_to_the_platform():
    from app.modules.platform.platform_settings import PLATFORM_KEYS

    ai_keys = {"n8n_webhook_url", "n8n_analyst_webhook_url", "n8n_webhook_token"}
    assert ai_keys <= PLATFORM_KEYS
    assert ai_keys.isdisjoint(definition.key for definition in settings_service.SETTING_DEFS)


def test_business_timezones_use_iana_names_and_current_gmt_offset():
    items = settings_service.list_business_timezones(
        datetime(2026, 9, 24, 12, tzinfo=timezone.utc)
    )
    by_id = {item["id"]: item for item in items}

    assert by_id["America/Lima"]["label"] == "America/Lima (GMT-05:00)"
    assert by_id["America/Lima"]["offset_minutes"] == -300
    assert "Etc/GMT+5" not in by_id


def test_business_timezone_validation_rejects_unknown_or_technical_zones():
    assert settings_service.validate_business_timezone(" America/Lima ") == "America/Lima"
    with pytest.raises(ValueError, match="IANA"):
        settings_service.validate_business_timezone("America/No_Existe")
    with pytest.raises(ValueError, match="geográfica"):
        settings_service.validate_business_timezone("Etc/GMT+5")
