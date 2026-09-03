"""/api/chats/history/availability según la integración de la instancia.

Meta Cloud API no tiene equivalente de chat/findMessages (historial
retroactivo): solo Baileys puede traerlo. Antes de esto el endpoint solo
miraba si Evolution estaba configurada (is_configured), sin importar la
integración -- una instancia Business bien configurada ofrecía un botón
de "ver historial anterior" que siempre iba a fallar.
"""

from unittest.mock import AsyncMock

import pytest

from routers import chats
from services.evolution_service import EvolutionApiError


@pytest.mark.asyncio
async def test_history_available_for_baileys_instance(monkeypatch):
    monkeypatch.setattr(chats, "get_instance_capabilities", AsyncMock(return_value={
        "integration": "WHATSAPP-BAILEYS",
        "official_sending_supported": False,
        "history_available": True,
        "edit_delete_supported": True,
        "reason": None,
    }))

    result = await chats.get_history_availability()

    assert result == {"available": True}


@pytest.mark.asyncio
async def test_history_unavailable_for_business_instance(monkeypatch):
    monkeypatch.setattr(chats, "get_instance_capabilities", AsyncMock(return_value={
        "integration": "WHATSAPP-BUSINESS",
        "official_sending_supported": True,
        "history_available": False,
        "edit_delete_supported": False,
        "reason": None,
    }))

    result = await chats.get_history_availability()

    assert result == {"available": False}


@pytest.mark.asyncio
async def test_history_unavailable_when_evolution_unreachable(monkeypatch):
    """Sin poder confirmar la integración, no se ofrece un botón que capaz
    falla -- mismo criterio conservador que ya usa get_instance_capabilities
    para sus otras banderas."""
    monkeypatch.setattr(
        chats, "get_instance_capabilities",
        AsyncMock(side_effect=EvolutionApiError("Evolution API respondió 500")),
    )

    result = await chats.get_history_availability()

    assert result == {"available": False}
