from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from models.schemas import LeadCreate
from routers.chats import leads
from services.custom_fields import CustomFieldError


USER = SimpleNamespace(id=7, role="admin")


@pytest.fixture
def dependencies(monkeypatch):
    monkeypatch.setattr(leads, "effective_country_code", AsyncMock(return_value="51"))
    monkeypatch.setattr(leads, "normalize_phone", lambda phone, _code: phone)
    monkeypatch.setattr(leads.manager, "broadcast", AsyncMock())
    monkeypatch.setattr(leads, "trigger_lead_created", AsyncMock())
    create = AsyncMock(return_value={"chat_id": "lead-1"})
    monkeypatch.setattr(leads, "create_lead", create)
    normalize = AsyncMock(return_value={"sede": "Centro"})
    monkeypatch.setattr(leads, "normalize_values", normalize)
    return create, normalize


async def test_create_lead_validates_and_persists_business_fields(dependencies):
    create, normalize = dependencies
    result = await leads.create_chat(
        LeadCreate(phone="51987654321", name="Ana", custom_fields={"sede": "Centro"}), USER
    )

    assert result["chat_id"] == "lead-1"
    normalize.assert_awaited_once_with("lead", {"sede": "Centro"}, require_required=True)
    assert create.await_args.kwargs["custom_fields"] == {"sede": "Centro"}


async def test_create_lead_rejects_missing_required_business_field(dependencies):
    create, normalize = dependencies
    normalize.side_effect = CustomFieldError("Completa los campos obligatorios: Sede")

    with pytest.raises(HTTPException) as exc:
        await leads.create_chat(LeadCreate(phone="51987654321", name="Ana"), USER)

    assert exc.value.status_code == 422
    assert "Sede" in exc.value.detail
    create.assert_not_awaited()
