from datetime import datetime
from unittest.mock import AsyncMock

import httpx
import pytest

from routers import chats
from services import evolution_service, whatsapp_capabilities
from services.evolution_channel import EvolutionHistoryReader
from services.evolution_service import EvolutionApiError
from tests.conftest import FakeChannelStatus, FakeEditor, install_channel
from fastapi import HTTPException


def _evolution(**flags):
    return AsyncMock(return_value={
        "integration": "WHATSAPP-BAILEYS",
        "official_sending_supported": False,
        "history_available": False,
        "edit_delete_supported": False,
        "reason": None,
        **flags,
    })


@pytest.fixture(autouse=True)
def connected_channel(monkeypatch):
    monkeypatch.setattr(whatsapp_capabilities, "default_interactive_footer", AsyncMock(return_value="Clínica"))
    install_channel(monkeypatch, history=EvolutionHistoryReader())


async def test_history_available_for_baileys_instance(monkeypatch):
    monkeypatch.setattr(evolution_service, "get_instance_capabilities", _evolution(history_available=True))

    assert await chats.get_history_availability() == {"available": True}


async def test_history_unavailable_for_business_instance(monkeypatch):
    monkeypatch.setattr(
        evolution_service, "get_instance_capabilities",
        _evolution(integration="WHATSAPP-BUSINESS", history_available=False),
    )

    assert await chats.get_history_availability() == {"available": False}


@pytest.mark.parametrize("error", [EvolutionApiError("Evolution API respondió 500"), httpx.ConnectError("sin red")])
async def test_history_unavailable_when_evolution_unreachable(monkeypatch, error):
    monkeypatch.setattr(evolution_service, "get_instance_capabilities", AsyncMock(side_effect=error))

    assert await chats.get_history_availability() == {"available": False}


async def test_capabilities_follow_the_active_channel(monkeypatch):
    monkeypatch.setattr(evolution_service, "get_instance_capabilities", _evolution(history_available=True))

    without_editor = await whatsapp_capabilities.get_whatsapp_capabilities()
    install_channel(monkeypatch, editor=FakeEditor(), history=None)
    with_editor = await whatsapp_capabilities.get_whatsapp_capabilities()

    assert (without_editor["edit_delete_supported"], without_editor["history_available"]) == (False, True)
    assert (with_editor["edit_delete_supported"], with_editor["history_available"]) == (True, False)


async def test_capabilities_report_what_the_channel_says_about_itself(monkeypatch):
    """El motivo lo redacta el adaptador: este módulo no sabe qué proveedor
    está conectado ni qué le falta configurar."""
    monkeypatch.setattr(evolution_service, "get_instance_capabilities", _evolution())
    install_channel(monkeypatch, status=FakeChannelStatus(
        configured=False, reason="Falta enchufar el canal",
    ))

    capabilities = await whatsapp_capabilities.get_whatsapp_capabilities()

    assert capabilities["integration"] is None
    assert capabilities["official_sending_supported"] is False
    assert capabilities["reason"] == "Falta enchufar el canal"


async def test_a_configured_channel_reports_its_integration_name(monkeypatch):
    monkeypatch.setattr(evolution_service, "get_instance_capabilities", _evolution())
    install_channel(monkeypatch, status=FakeChannelStatus(integration="OTRO-CANAL"))

    capabilities = await whatsapp_capabilities.get_whatsapp_capabilities()

    assert capabilities["integration"] == "OTRO-CANAL"
    assert capabilities["reason"] is None


async def test_history_route_refuses_when_channel_has_no_history(monkeypatch):
    install_channel(monkeypatch, history=None)

    with pytest.raises(HTTPException) as exc:
        await chats.get_whatsapp_history("51999@s.whatsapp.net", None, None)

    assert exc.value.status_code == 409


async def test_history_route_reads_through_the_channel(monkeypatch):
    history = AsyncMock()
    history.is_available.return_value = True
    history.fetch.return_value = {"items": []}
    install_channel(monkeypatch, history=history)
    before = datetime(2026, 9, 1)

    assert await chats.get_whatsapp_history("51999@s.whatsapp.net", 2, before) == {"items": []}
    history.fetch.assert_awaited_once_with("51999@s.whatsapp.net", 2, before)
