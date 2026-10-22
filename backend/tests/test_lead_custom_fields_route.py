from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.modules.leads.schemas import LeadCreate
from app.modules.leads import api as leads
from app.modules.catalogs.custom_fields import CustomFieldError


USER = SimpleNamespace(id=7, role="admin")


@pytest.fixture
def dependencies(in_memory_leads, monkeypatch):
    monkeypatch.setattr(leads, "effective_country_code", AsyncMock(return_value="51"))
    monkeypatch.setattr(leads, "fetch_chat", AsyncMock(side_effect=lambda chat_id: {"chat_id": chat_id}))
    normalize = AsyncMock(return_value={"sede": "Centro"})
    monkeypatch.setattr(leads, "normalize_values", normalize)
    return in_memory_leads.repository, normalize


async def test_create_lead_validates_and_persists_business_fields(dependencies):
    repository, normalize = dependencies
    result = await leads.create_chat(
        LeadCreate(phone="51987654321", name="Ana", custom_fields={"sede": "Centro"}), USER
    )

    normalize.assert_awaited_once_with("lead", {"sede": "Centro"}, require_required=True)
    assert repository.column(result["chat_id"], "custom_fields") == {"sede": "Centro"}


async def test_create_lead_rejects_missing_required_business_field(dependencies):
    repository, normalize = dependencies
    normalize.side_effect = CustomFieldError("Completa los campos obligatorios: Sede")

    with pytest.raises(HTTPException) as exc:
        await leads.create_chat(LeadCreate(phone="51987654321", name="Ana"), USER)

    assert exc.value.status_code == 422
    assert "Sede" in exc.value.detail
    assert repository.leads == {}
