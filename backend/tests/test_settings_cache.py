import base64
from unittest.mock import AsyncMock

import pytest

from services import secret_cipher, settings_service


@pytest.fixture(autouse=True)
def empty_settings_cache():
    settings_service.invalidate_settings_cache()
    yield
    settings_service.invalidate_settings_cache()


@pytest.mark.asyncio
async def test_effective_settings_are_loaded_once_and_reused(monkeypatch):
    load_values = AsyncMock(return_value={
        "evolution_api_url": "https://evolution.test",
        "evolution_instance": "dermica",
    })
    monkeypatch.setattr(settings_service, "_db_values", load_values)
    monkeypatch.setattr(
        settings_service,
        "_env_default",
        lambda key: "secret-from-env" if key == "evolution_api_key" else "",
    )

    first = await settings_service.get_effective_many((
        "evolution_api_url", "evolution_api_key", "evolution_instance",
    ))
    second = await settings_service.get_effective("evolution_api_url")

    assert first == {
        "evolution_api_url": "https://evolution.test",
        "evolution_api_key": "secret-from-env",
        "evolution_instance": "dermica",
    }
    assert second == "https://evolution.test"
    load_values.assert_awaited_once_with()


@pytest.mark.asyncio
async def test_invalidating_cache_forces_a_reload(monkeypatch):
    load_values = AsyncMock(side_effect=[
        {"evolution_instance": "first"},
        {"evolution_instance": "second"},
    ])
    monkeypatch.setattr(settings_service, "_db_values", load_values)

    assert await settings_service.get_effective("evolution_instance") == "first"
    settings_service.invalidate_settings_cache()
    assert await settings_service.get_effective("evolution_instance") == "second"
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

    monkeypatch.setattr(settings_service, "get_sessionmaker", lambda: FakeSession)
    monkeypatch.setattr(
        secret_cipher.settings,
        "settings_encryption_key",
        base64.urlsafe_b64encode(b"s" * 32).decode("ascii"),
    )

    await settings_service.update_settings({"evolution_api_key": "plain-secret"})

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

    monkeypatch.setattr(settings_service, "get_sessionmaker", lambda: FakeSession)

    public_url = "https://evolution.example.test"
    await settings_service.update_settings({"evolution_api_url": public_url})

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

    monkeypatch.setattr(settings_service, "get_sessionmaker", lambda: FakeSession)
    monkeypatch.setattr(
        secret_cipher.settings,
        "settings_encryption_key",
        base64.urlsafe_b64encode(b"s" * 32).decode("ascii"),
    )
    public_url = "https://n8n.example.test/webhook"
    encrypted_public_url = secret_cipher.encrypt_secret(
        "n8n_webhook_url", public_url
    )
    monkeypatch.setattr(
        settings_service,
        "_raw_db_values",
        AsyncMock(return_value={
            "n8n_webhook_url": encrypted_public_url,
            "n8n_webhook_token": "legacy-plaintext-token",
            "evolution_instance": "already-plain",
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
        "evolution_api_url": "https://evolution.test",
        "evolution_api_key": "decrypted-in-backend-only",
    }))
    monkeypatch.setattr(settings_service, "_env_default", lambda _key: "")

    items = {item["key"]: item for item in await settings_service.list_settings()}

    assert items["evolution_api_url"]["value"] == "https://evolution.test"
    assert items["evolution_api_key"]["configured"] is True
    assert items["evolution_api_key"]["value"] is None
