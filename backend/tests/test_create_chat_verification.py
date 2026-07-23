"""Alta de leads: normalización del teléfono y verificación en WhatsApp.

Se llama a create_chat directo (sin HTTP) con dobles de los colaboradores,
siguiendo el patrón del resto de la suite: nada toca PostgreSQL ni Evolution.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from models.schemas import LeadCreate
from routers import chats
from services.db_service import LeadAlreadyExistsError
from services.evolution_service import EvolutionApiError


ADMIN = SimpleNamespace(role="admin", id=1)


@pytest.fixture
def create_deps(monkeypatch):
    """Dobles por defecto: país 51, Evolution confirma existencia, insert OK."""
    created_lead = AsyncMock(return_value={"chat_id": "51906471403@s.whatsapp.net"})
    check = AsyncMock(return_value=[{"exists": True, "jid": "51906471403@s.whatsapp.net"}])
    monkeypatch.setattr(chats, "effective_country_code", AsyncMock(return_value="51"))
    monkeypatch.setattr(chats, "check_whatsapp_numbers", check)
    monkeypatch.setattr(chats, "create_lead", created_lead)
    monkeypatch.setattr(chats, "trigger_lead_created", AsyncMock())
    monkeypatch.setattr(chats, "manager", SimpleNamespace(broadcast=AsyncMock()))
    return SimpleNamespace(create_lead=created_lead, check=check)


def _body(phone="906471403", name="Ana"):
    return LeadCreate(phone=phone, name=name)


@pytest.mark.asyncio
async def test_number_without_whatsapp_blocks_creation(create_deps):
    create_deps.check.return_value = [{"exists": False, "jid": None}]

    with pytest.raises(HTTPException) as exc:
        await chats.create_chat(_body(), ADMIN)

    assert exc.value.status_code == 422
    create_deps.create_lead.assert_not_awaited()


@pytest.mark.asyncio
async def test_evolution_down_fails_open(create_deps):
    create_deps.check.side_effect = EvolutionApiError("sin conexión")

    lead = await chats.create_chat(_body(), ADMIN)

    assert lead["chat_id"] == "51906471403@s.whatsapp.net"
    assert create_deps.create_lead.await_args.kwargs["remote_jid"] is None


@pytest.mark.asyncio
async def test_phone_is_normalized_and_canonical_jid_used(create_deps):
    await chats.create_chat(_body(phone="906 471 403"), ADMIN)

    kwargs = create_deps.create_lead.await_args.kwargs
    assert kwargs["phone"] == "51906471403"
    assert kwargs["remote_jid"] == "51906471403@s.whatsapp.net"
    create_deps.check.assert_awaited_once_with(["51906471403"])


@pytest.mark.asyncio
async def test_invalid_phone_is_rejected_before_verification(create_deps):
    with pytest.raises(HTTPException) as exc:
        await chats.create_chat(_body(phone="tel: juan"), ADMIN)

    assert exc.value.status_code == 400
    create_deps.check.assert_not_awaited()
    create_deps.create_lead.assert_not_awaited()


@pytest.mark.asyncio
async def test_duplicate_still_maps_to_409(create_deps):
    create_deps.create_lead.side_effect = LeadAlreadyExistsError("51906471403@s.whatsapp.net")

    with pytest.raises(HTTPException) as exc:
        await chats.create_chat(_body(), ADMIN)

    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_malformed_verification_response_fails_open(create_deps):
    create_deps.check.return_value = ["algo raro"]

    lead = await chats.create_chat(_body(), ADMIN)

    assert lead["chat_id"] == "51906471403@s.whatsapp.net"
    assert create_deps.create_lead.await_args.kwargs["remote_jid"] is None
