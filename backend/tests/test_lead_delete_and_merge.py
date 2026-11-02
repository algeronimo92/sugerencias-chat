"""Borrar y fusionar leads desde la API: comandos reales, repositorio en memoria."""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from app.modules.leads import api as chats
from app.modules.leads.domain.errors import LeadNotFound
from app.modules.leads.domain.events import LeadDeleted, LeadsMerged
from app.modules.leads.schemas import LeadMergeRequest

LEAD_ID = "7b08f4d9-855f-4718-b95f-9c021da52f77"
OTHER_ID = "a1b2c3d4-855f-4718-b95f-9c021da52f77"
ADMIN = SimpleNamespace(role="admin", id=1)


async def test_delete_chat_removes_the_lead_and_announces_it(in_memory_leads):
    in_memory_leads.repository.seed(LEAD_ID)

    await chats.delete_chat(LEAD_ID, ADMIN)

    assert LEAD_ID not in in_memory_leads.repository.leads
    [event] = in_memory_leads.published
    assert isinstance(event, LeadDeleted) and event.actor.user_id == ADMIN.id


async def test_delete_chat_missing_lead_returns_404(in_memory_leads):
    with pytest.raises(LeadNotFound) as exc:
        await chats.delete_chat(LEAD_ID, ADMIN)
    assert exc.value.status_code == 404


async def test_merge_keeps_the_lead_of_the_url_and_removes_the_other(in_memory_leads, monkeypatch):
    in_memory_leads.repository.seed(LEAD_ID)
    in_memory_leads.repository.seed(OTHER_ID)
    monkeypatch.setattr(chats, "fetch_chat", AsyncMock(return_value={"chat_id": LEAD_ID}))

    result = await chats.merge_chat(LEAD_ID, LeadMergeRequest(other_id=OTHER_ID), ADMIN)

    # El lead de la URL (chat_id) es el destino que sobrevive; other_id es el
    # origen que se fusiona y se borra.
    assert in_memory_leads.repository.merged == [(OTHER_ID, LEAD_ID)]
    [event] = in_memory_leads.published
    assert isinstance(event, LeadsMerged) and (event.lead_id, event.source_id) == (LEAD_ID, OTHER_ID)
    assert result == {"chat_id": LEAD_ID}


async def test_merge_target_disappeared_returns_404(in_memory_leads, monkeypatch):
    """La fusión aplicó bien pero el destino se borró justo después (carrera)."""
    monkeypatch.setattr(chats, "fetch_chat", AsyncMock(return_value=None))

    with pytest.raises(HTTPException) as exc:
        await chats.merge_chat(LEAD_ID, LeadMergeRequest(other_id=OTHER_ID), ADMIN)

    assert exc.value.status_code == 404
