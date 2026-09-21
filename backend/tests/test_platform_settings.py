"""Las claves de plataforma no pueden salir del `app_settings` de un negocio.

En multitenant esa tabla vive dentro del schema de cada tenant, y estas tres
claves se leen en rutas que corren antes de resolverlo (el challenge de Meta,
la firma HMAC y la autenticación de `/api/webhooks/*`). Si la lectura cayera a
la base, en esas rutas consultaría un `public.app_settings` que ya no existe.
"""

from unittest.mock import AsyncMock

import pytest

from services import platform_settings


@pytest.fixture
def env(monkeypatch):
    def _set(*, multitenancy_enabled: bool, **values: str) -> None:
        monkeypatch.setattr(
            platform_settings.settings, "multitenancy_enabled", multitenancy_enabled
        )
        for key, value in values.items():
            monkeypatch.setattr(platform_settings.settings, key, value)

    return _set


@pytest.mark.asyncio
async def test_rechaza_una_clave_que_no_es_de_plataforma(env):
    env(multitenancy_enabled=True)
    with pytest.raises(KeyError):
        await platform_settings.platform_setting("meta_access_token")


@pytest.mark.asyncio
async def test_en_multitenant_nunca_consulta_la_base(env, monkeypatch):
    env(multitenancy_enabled=True, meta_verify_token="")
    consulta = AsyncMock(return_value="valor-de-la-base")
    monkeypatch.setattr("services.settings_service.get_effective", consulta)

    assert await platform_settings.platform_setting("meta_verify_token") == ""
    consulta.assert_not_awaited()


@pytest.mark.asyncio
async def test_el_entorno_gana_sobre_la_base(env, monkeypatch):
    env(multitenancy_enabled=False, meta_app_secret="  del-entorno  ")
    consulta = AsyncMock(return_value="de-la-base")
    monkeypatch.setattr("services.settings_service.get_effective", consulta)

    assert await platform_settings.platform_setting("meta_app_secret") == "del-entorno"
    consulta.assert_not_awaited()


@pytest.mark.asyncio
async def test_en_legacy_cae_a_la_base(env, monkeypatch):
    """Instalaciones single-tenant guardan estas claves en Configuración."""
    env(multitenancy_enabled=False, inbound_webhook_token="")
    monkeypatch.setattr(
        "services.settings_service.get_effective", AsyncMock(return_value=" de-la-base ")
    )

    assert await platform_settings.platform_setting("inbound_webhook_token") == "de-la-base"
