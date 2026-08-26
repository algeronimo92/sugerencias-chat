"""Borrar un lead completo o fusionar un duplicado en otro.

Ambas acciones son irreversibles (no hay soft-delete para leads, y fusionar
borra el origen tras mover su historial), así que quedan atrás de
require_admin: no cualquier vendedor las puede disparar.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from routers import chats
from services.lead_merge import LeadMergeError

LEAD_ID = "7b08f4d9-855f-4718-b95f-9c021da52f77"
OTHER_ID = "a1b2c3d4-855f-4718-b95f-9c021da52f77"
ADMIN = SimpleNamespace(role="admin", id=1)


@pytest.mark.asyncio
async def test_delete_chat_removes_lead_and_broadcasts(monkeypatch):
    delete_lead = AsyncMock(return_value=True)
    monkeypatch.setattr(chats, "delete_lead", delete_lead)
    broadcast = AsyncMock()
    monkeypatch.setattr(chats.manager, "broadcast", broadcast)

    await chats.delete_chat(LEAD_ID, ADMIN)

    delete_lead.assert_awaited_once_with(LEAD_ID)
    broadcast.assert_awaited_once_with(
        {"type": "chats_updated", "chat_id": LEAD_ID, "reason": "lead_deleted"}
    )


@pytest.mark.asyncio
async def test_delete_chat_missing_lead_returns_404(monkeypatch):
    monkeypatch.setattr(chats, "delete_lead", AsyncMock(return_value=False))

    with pytest.raises(HTTPException) as exc:
        await chats.delete_chat(LEAD_ID, ADMIN)

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_merge_chat_moves_source_into_target_and_broadcasts_both(monkeypatch):
    merge_leads = AsyncMock()
    monkeypatch.setattr(chats, "merge_leads", merge_leads)
    monkeypatch.setattr(chats, "fetch_chat", AsyncMock(return_value={"chat_id": LEAD_ID}))
    broadcast = AsyncMock()
    monkeypatch.setattr(chats.manager, "broadcast", broadcast)

    result = await chats.merge_chat(LEAD_ID, chats.LeadMergeRequest(other_id=OTHER_ID), ADMIN)

    # El lead de la URL (chat_id) es el destino que sobrevive; other_id es el
    # origen que se fusiona y se borra.
    merge_leads.assert_awaited_once_with(OTHER_ID, LEAD_ID, apply=True)
    assert broadcast.await_count == 2
    reasons = {call.args[0]["chat_id"]: call.args[0]["reason"] for call in broadcast.await_args_list}
    assert reasons == {LEAD_ID: "lead_updated", OTHER_ID: "lead_deleted"}
    assert result == {"chat_id": LEAD_ID}


@pytest.mark.asyncio
async def test_merge_chat_invalid_pair_returns_400(monkeypatch):
    monkeypatch.setattr(chats, "merge_leads", AsyncMock(side_effect=LeadMergeError("mismo lead")))

    with pytest.raises(HTTPException) as exc:
        await chats.merge_chat(LEAD_ID, chats.LeadMergeRequest(other_id=LEAD_ID), ADMIN)

    assert exc.value.status_code == 400


@pytest.mark.asyncio
async def test_merge_chat_target_disappeared_returns_404(monkeypatch):
    """merge_leads aplicó bien pero el destino se borró justo después (carrera)."""
    monkeypatch.setattr(chats, "merge_leads", AsyncMock())
    monkeypatch.setattr(chats, "fetch_chat", AsyncMock(return_value=None))

    with pytest.raises(HTTPException) as exc:
        await chats.merge_chat(LEAD_ID, chats.LeadMergeRequest(other_id=OTHER_ID), ADMIN)

    assert exc.value.status_code == 404
