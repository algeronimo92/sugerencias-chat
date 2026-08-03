"""Cambio de teléfono sin cambiar la identidad interna del lead."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from db.models import Base, Lead
from models.schemas import LeadUpdate
from routers import chats
from services.db_service import LeadAlreadyExistsError


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
def update_deps(monkeypatch):
    updated = AsyncMock(return_value={"chat_id": CHAT_ID})
    rekeyed = AsyncMock(return_value=CHAT_ID)
    check = AsyncMock(return_value=[{"exists": True, "jid": None}])
    monkeypatch.setattr(chats, "effective_country_code", AsyncMock(return_value="51"))
    monkeypatch.setattr(chats, "check_whatsapp_numbers", check)
    monkeypatch.setattr(chats, "update_lead", updated)
    monkeypatch.setattr(chats, "rekey_lead_phone", rekeyed)
    monkeypatch.setattr(chats, "manager", SimpleNamespace(broadcast=AsyncMock()))
    return SimpleNamespace(update_lead=updated, rekey=rekeyed, check=check)


@pytest.mark.asyncio
async def test_same_number_refreshes_alias_without_changing_id(update_deps):
    body = LeadUpdate(phone="+51 906 471 403", name="Ana")

    await chats.update_chat(CHAT_ID, body, ADMIN)

    update_deps.rekey.assert_awaited_once_with(CHAT_ID, "51906471403", "51906471403@s.whatsapp.net", ADMIN.id)
    values = update_deps.update_lead.await_args.args[1]
    assert "telefono" not in values
    assert values["nombre"] == "Ana"


@pytest.mark.asyncio
async def test_different_number_triggers_rekey(update_deps):
    body = LeadUpdate(phone="999888777")

    result = await chats.update_chat(CHAT_ID, body, ADMIN)

    update_deps.rekey.assert_awaited_once_with(CHAT_ID, "51999888777", "51999888777@s.whatsapp.net", ADMIN.id)
    assert result["chat_id"] == CHAT_ID


@pytest.mark.asyncio
async def test_rekey_collision_maps_to_409(update_deps):
    update_deps.rekey.side_effect = LeadAlreadyExistsError("51999888777@s.whatsapp.net")

    with pytest.raises(HTTPException) as exc:
        await chats.update_chat(CHAT_ID, LeadUpdate(phone="999888777"), ADMIN)

    assert exc.value.status_code == 409


@pytest.mark.asyncio
async def test_rekey_blocked_if_new_number_has_no_whatsapp(update_deps):
    update_deps.check.return_value = [{"exists": False}]

    with pytest.raises(HTTPException) as exc:
        await chats.update_chat(CHAT_ID, LeadUpdate(phone="999888777"), ADMIN)

    assert exc.value.status_code == 422
    update_deps.rekey.assert_not_awaited()


@pytest.mark.asyncio
async def test_explicit_null_phone_is_ignored(update_deps):
    body = LeadUpdate(phone=None, name="Ana")

    await chats.update_chat(CHAT_ID, body, ADMIN)

    update_deps.rekey.assert_not_awaited()
    values = update_deps.update_lead.await_args.args[1]
    assert "telefono" not in values


def test_lead_pk_is_internal_id():
    assert [c.name for c in Lead.__table__.primary_key.columns] == ["id"]
    assert Lead.__table__.c.id.type.python_type is str
