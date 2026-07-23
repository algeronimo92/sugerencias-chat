"""Cambio de teléfono de un lead (re-key del remote_jid).

Sin PostgreSQL: se verifica la cobertura de tablas hijas por introspección del
metadata y el comportamiento del router con dobles.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from db.models import Base, Lead
from models.schemas import LeadUpdate
from routers import chats
from services.db_service import (
    _REKEY_CHILDREN,
    LeadAlreadyExistsError,
    LeadHasMessagesError,
)


ADMIN = SimpleNamespace(role="admin", id=1)


def test_rekey_children_covers_every_fk_to_leads():
    """Si alguien agrega una tabla nueva con FK a leads.remote_jid y no la suma
    a _REKEY_CHILDREN, el re-key perdería esas filas (ON DELETE CASCADE)."""
    covered = {(model.__tablename__, column) for model, column in _REKEY_CHILDREN}
    for table in Base.metadata.tables.values():
        for column in table.columns:
            for fk in column.foreign_keys:
                if fk.column.table.name == "leads" and fk.column.name == "remote_jid":
                    assert (table.name, column.name) in covered, (
                        f"{table.name}.{column.name} referencia leads.remote_jid "
                        "y no está en _REKEY_CHILDREN"
                    )
    # wsp_messages no tiene FK pero guarda el jid: tiene que estar igual.
    assert ("wsp_messages", "chat_id") in covered


def test_rekey_children_columns_exist():
    for model, column in _REKEY_CHILDREN:
        assert hasattr(model, column), f"{model.__name__}.{column} no existe"


@pytest.fixture
def update_deps(monkeypatch):
    updated = AsyncMock(return_value={"chat_id": "51906471403@s.whatsapp.net"})
    rekeyed = AsyncMock(return_value={"chat_id": "51999888777@s.whatsapp.net"})
    check = AsyncMock(return_value=[{"exists": True, "jid": None}])
    monkeypatch.setattr(chats, "effective_country_code", AsyncMock(return_value="51"))
    monkeypatch.setattr(chats, "check_whatsapp_numbers", check)
    monkeypatch.setattr(chats, "update_lead", updated)
    monkeypatch.setattr(chats, "rekey_lead_phone", rekeyed)
    monkeypatch.setattr(chats, "manager", SimpleNamespace(broadcast=AsyncMock()))
    return SimpleNamespace(update_lead=updated, rekey=rekeyed, check=check)


CHAT_ID = "51906471403@s.whatsapp.net"


@pytest.mark.asyncio
async def test_same_number_only_updates_display(update_deps):
    body = LeadUpdate(phone="+51 906 471 403", name="Ana")

    await chats.update_chat(CHAT_ID, body, ADMIN)

    update_deps.rekey.assert_not_awaited()
    values = update_deps.update_lead.await_args.args[1]
    assert values["telefono"] == "+51906471403"
    assert values["nombre"] == "Ana"


@pytest.mark.asyncio
async def test_different_number_triggers_rekey(update_deps):
    body = LeadUpdate(phone="999888777")

    result = await chats.update_chat(CHAT_ID, body, ADMIN)

    update_deps.rekey.assert_awaited_once_with(CHAT_ID, "51999888777", "51999888777@s.whatsapp.net", ADMIN.id)
    assert result["chat_id"] == "51906471403@s.whatsapp.net"  # respuesta del update_lead final


@pytest.mark.asyncio
async def test_lead_with_conversation_cannot_change_number(update_deps):
    update_deps.rekey.side_effect = LeadHasMessagesError(CHAT_ID)

    with pytest.raises(HTTPException) as exc:
        await chats.update_chat(CHAT_ID, LeadUpdate(phone="999888777"), ADMIN)

    assert exc.value.status_code == 409
    assert "conversación" in exc.value.detail


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


def test_lead_pk_is_remote_jid():
    # El re-key asume esta PK; si cambia, revisar rekey_lead_phone entero.
    assert [c.name for c in Lead.__table__.primary_key.columns] == ["remote_jid"]
