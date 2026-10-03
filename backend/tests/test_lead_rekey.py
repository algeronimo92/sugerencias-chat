"""Cambio de teléfono sin cambiar la identidad interna del lead."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.db.models import Base
from app.db.models.leads import Lead
from app.modules.leads.schemas import LeadUpdate
from app.modules.leads import api as chats
from app.modules.leads.domain.errors import LeadAlreadyExists


ADMIN = SimpleNamespace(role="admin", id=1)
CHAT_ID = "7b08f4d9-855f-4718-b95f-9c021da52f77"


def test_every_lead_fk_targets_internal_id():
    for table in Base.metadata.tables.values():
        for column in table.columns:
            for fk in column.foreign_keys:
                if fk.column.table.name == "leads":
                    assert fk.column.name == "id", (
                        f"{table.name}.{column.name} debe referenciar leads.id"
                    )


@pytest.fixture
def leads_api(in_memory_leads, monkeypatch):
    repository = in_memory_leads.repository
    repository.seed(CHAT_ID, telefono="51906471403", nombre="Ana")
    repository.seed("otro-lead", telefono="51999888777")
    monkeypatch.setattr(chats, "effective_country_code", AsyncMock(return_value="51"))
    monkeypatch.setattr(chats, "fetch_chat", AsyncMock(return_value={"chat_id": CHAT_ID}))
    return repository


@pytest.mark.asyncio
async def test_same_number_refreshes_alias_without_changing_id(leads_api):
    body = LeadUpdate(phone="+51 906 471 403", name="Ana María")

    await chats.update_chat(CHAT_ID, body, ADMIN)

    assert leads_api.column(CHAT_ID, "telefono") == "51906471403"
    assert leads_api.column(CHAT_ID, "nombre") == "Ana María"


@pytest.mark.asyncio
async def test_different_number_changes_the_alias_not_the_id(leads_api):
    leads_api.leads.pop("otro-lead")

    result = await chats.update_chat(CHAT_ID, LeadUpdate(phone="999888777"), ADMIN)

    assert result["chat_id"] == CHAT_ID
    assert leads_api.column(CHAT_ID, "telefono") == "51999888777"
    assert leads_api.audit(CHAT_ID)[0].new_value == {"phone": "51999888777"}


@pytest.mark.asyncio
async def test_a_number_in_use_is_a_conflict_and_changes_nothing(leads_api):
    with pytest.raises(LeadAlreadyExists) as exc:
        await chats.update_chat(CHAT_ID, LeadUpdate(phone="999888777", name="Otra"), ADMIN)

    assert exc.value.status_code == 409
    assert leads_api.column(CHAT_ID, "nombre") == "Ana"


@pytest.mark.asyncio
async def test_explicit_null_phone_is_ignored(leads_api):
    await chats.update_chat(CHAT_ID, LeadUpdate(phone=None, name="Ana María"), ADMIN)

    assert leads_api.column(CHAT_ID, "telefono") == "51906471403"
    assert [record.new_value for record in leads_api.audit(CHAT_ID)] == [{"nombre": "Ana María"}]


def test_lead_pk_is_internal_id():
    assert [c.name for c in Lead.__table__.primary_key.columns] == ["id"]
    assert Lead.__table__.c.id.type.python_type is str
