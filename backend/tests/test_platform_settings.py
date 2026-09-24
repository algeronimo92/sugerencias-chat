"""Las credenciales Tech Provider viven fuera de los schemas tenant."""

from unittest.mock import AsyncMock

import pytest

from services import platform_settings
from routers import settings as settings_router


@pytest.fixture(autouse=True)
def clean_cache():
    platform_settings.invalidate_platform_settings_cache()
    yield
    platform_settings.invalidate_platform_settings_cache()


@pytest.mark.asyncio
async def test_rejects_tenant_key() -> None:
    with pytest.raises(KeyError):
        await platform_settings.platform_setting("meta_access_token")


@pytest.mark.asyncio
async def test_platform_database_wins_over_environment(monkeypatch) -> None:
    monkeypatch.setattr(platform_settings.settings, "meta_app_secret", "environment-secret")
    monkeypatch.setattr(
        platform_settings,
        "_raw_database_values",
        AsyncMock(return_value={"meta_app_secret": "ciphertext"}),
    )
    monkeypatch.setattr(
        platform_settings,
        "decrypt_secret",
        lambda _key, _value, **_kwargs: "database-secret",
    )
    monkeypatch.setattr(platform_settings, "_legacy_single_tenant_values", AsyncMock(return_value={}))

    assert await platform_settings.platform_setting("meta_app_secret") == "database-secret"


@pytest.mark.asyncio
async def test_environment_is_fallback_when_platform_row_is_empty(monkeypatch) -> None:
    monkeypatch.setattr(platform_settings.settings, "meta_verify_token", " verify-from-env ")
    monkeypatch.setattr(platform_settings, "_raw_database_values", AsyncMock(return_value={}))
    monkeypatch.setattr(platform_settings, "_legacy_single_tenant_values", AsyncMock(return_value={}))

    assert await platform_settings.platform_setting("meta_verify_token") == "verify-from-env"


@pytest.mark.asyncio
async def test_legacy_tenant_value_is_only_last_resort(monkeypatch) -> None:
    monkeypatch.setattr(platform_settings.settings, "meta_app_id", "")
    monkeypatch.setattr(platform_settings, "_raw_database_values", AsyncMock(return_value={}))
    monkeypatch.setattr(
        platform_settings,
        "_legacy_single_tenant_values",
        AsyncMock(return_value={"meta_app_id": "legacy-app"}),
    )

    assert await platform_settings.platform_setting("meta_app_id") == "legacy-app"


@pytest.mark.asyncio
async def test_list_never_returns_secret_values(monkeypatch) -> None:
    values = {key: "configured" for key in platform_settings.PLATFORM_KEYS}
    sources = {key: "platform" for key in platform_settings.PLATFORM_KEYS}
    monkeypatch.setattr(platform_settings, "_resolve_uncached", AsyncMock(return_value=(values, sources)))

    items = {item["key"]: item for item in await platform_settings.list_platform_settings()}

    assert items["meta_app_id"]["value"] == "configured"
    assert items["meta_config_id"]["value"] == "configured"
    assert items["meta_app_secret"]["configured"] is True
    assert items["meta_app_secret"]["value"] is None
    assert items["inbound_webhook_token"]["value"] is None


@pytest.mark.asyncio
async def test_update_rejects_unknown_key() -> None:
    with pytest.raises(ValueError):
        await platform_settings.update_platform_settings({"meta_access_token": "tenant-only"})


@pytest.mark.asyncio
async def test_single_tenant_migrates_only_missing_global_values(monkeypatch) -> None:
    monkeypatch.setattr(platform_settings.settings, "multitenancy_enabled", False)
    for key in platform_settings.PLATFORM_KEYS:
        monkeypatch.setattr(platform_settings.settings, key, "")
    monkeypatch.setattr(
        platform_settings,
        "_raw_database_values",
        AsyncMock(return_value={"meta_app_id": "already-global"}),
    )
    monkeypatch.setattr(
        platform_settings,
        "_legacy_single_tenant_values",
        AsyncMock(return_value={
            "meta_app_id": "legacy-app",
            "meta_app_secret": "legacy-secret",
        }),
    )
    update = AsyncMock()
    monkeypatch.setattr(platform_settings, "update_platform_settings", update)

    assert await platform_settings.migrate_legacy_platform_settings() == 1
    update.assert_awaited_once_with({"meta_app_secret": "legacy-secret"})


@pytest.mark.asyncio
async def test_tenant_public_config_only_exposes_non_secret_ids(monkeypatch) -> None:
    reader = AsyncMock(return_value={
        "meta_app_id": "APP123",
        "meta_config_id": "CONFIG456",
    })
    monkeypatch.setattr(settings_router, "platform_settings_many", reader)

    result = await settings_router.get_meta_public_config()

    assert result == {"app_id": "APP123", "config_id": "CONFIG456"}
    assert "secret" not in result
    reader.assert_awaited_once_with(("meta_app_id", "meta_config_id"))
