from unittest.mock import AsyncMock

import httpx
import pytest

from routers import chats
from services import whatsapp_capabilities
from services.evolution_service import EvolutionApiError


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
def meta_configured(monkeypatch):
    monkeypatch.setattr(whatsapp_capabilities.meta_service, "is_configured", AsyncMock(return_value=True))
    monkeypatch.setattr(whatsapp_capabilities, "default_interactive_footer", AsyncMock(return_value="Clínica"))


async def test_history_available_for_baileys_instance(monkeypatch):
    monkeypatch.setattr(whatsapp_capabilities, "get_instance_capabilities", _evolution(history_available=True))

    assert await chats.get_history_availability() == {"available": True}


async def test_history_unavailable_for_business_instance(monkeypatch):
    monkeypatch.setattr(
        whatsapp_capabilities, "get_instance_capabilities",
        _evolution(integration="WHATSAPP-BUSINESS", history_available=False),
    )

    assert await chats.get_history_availability() == {"available": False}


@pytest.mark.parametrize("error", [EvolutionApiError("Evolution API respondió 500"), httpx.ConnectError("sin red")])
async def test_history_unavailable_when_evolution_unreachable(monkeypatch, error):
    monkeypatch.setattr(whatsapp_capabilities, "get_instance_capabilities", AsyncMock(side_effect=error))

    assert await chats.get_history_availability() == {"available": False}


async def test_sending_through_meta_never_offers_edit_or_delete(monkeypatch):
    monkeypatch.setattr(
        whatsapp_capabilities, "get_instance_capabilities",
        _evolution(history_available=True, edit_delete_supported=True),
    )

    capabilities = await whatsapp_capabilities.get_whatsapp_capabilities()

    assert capabilities["edit_delete_supported"] is False
    assert capabilities["official_sending_supported"] is True


async def test_history_route_refuses_when_channel_has_no_history(monkeypatch):
    monkeypatch.setattr(whatsapp_capabilities, "get_instance_capabilities", _evolution(history_available=False))
    fetch = AsyncMock()
    monkeypatch.setattr(chats, "fetch_whatsapp_history", fetch)

    with pytest.raises(chats.HTTPException) as exc:
        await chats.get_whatsapp_history("51999@s.whatsapp.net", None, None)

    assert exc.value.status_code == 409
    fetch.assert_not_awaited()
