from unittest.mock import AsyncMock

import pytest

from services import whatsapp_connection


@pytest.fixture
def settings(monkeypatch):
    def configure(**values):
        monkeypatch.setattr(
            whatsapp_connection, "get_effective_many",
            AsyncMock(return_value={"whatsapp_active_connection": "", "evolution_instance": "", **values}),
        )

    return configure


async def test_uses_its_own_setting_when_it_is_configured(settings):
    settings(whatsapp_active_connection="numero-principal", evolution_instance="dermicapro")

    assert await whatsapp_connection.active_connection() == "numero-principal"


async def test_falls_back_to_the_evolution_instance_for_existing_data(settings):
    """Los alias ya guardados traen el nombre de instancia de Evolution: sin
    esta compatibilidad, los leads existentes dejarían de listarse."""
    settings(evolution_instance="dermicapro")

    assert await whatsapp_connection.active_connection() == "dermicapro"
    assert await whatsapp_connection.connection_scope() == ("dermicapro", "*")


async def test_without_an_active_connection_nothing_is_filtered(settings):
    settings()

    assert await whatsapp_connection.active_connection() == ""
    assert await whatsapp_connection.connection_scope() is None
