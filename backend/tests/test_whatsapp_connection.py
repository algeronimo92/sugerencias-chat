from unittest.mock import AsyncMock

import pytest

from app.integrations.whatsapp import connection as whatsapp_connection


@pytest.fixture
def settings(monkeypatch):
    def configure(**values):
        monkeypatch.setattr(
            whatsapp_connection, "get_effective_many",
            AsyncMock(return_value={
                "whatsapp_active_connection": "",
                "meta_phone_number_id": "",
                **values,
            }),
        )

    return configure


async def test_uses_its_own_setting_when_it_is_configured(settings):
    settings(
        whatsapp_active_connection="numero-principal",
        meta_phone_number_id="1264142756787940",
    )

    assert await whatsapp_connection.active_connection() == "numero-principal"


async def test_falls_back_to_the_connected_meta_number(settings):
    """Sin override manual, se deriva sola del número de Meta conectado."""
    settings(meta_phone_number_id="1264142756787940")

    assert await whatsapp_connection.active_connection() == "1264142756787940"
    assert await whatsapp_connection.connection_scope() == ("1264142756787940", "*")


async def test_without_an_active_connection_nothing_is_filtered(settings):
    settings()

    assert await whatsapp_connection.active_connection() == ""
    assert await whatsapp_connection.connection_scope() is None
