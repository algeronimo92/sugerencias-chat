"""Columnas huérfanas de leads que ahora sí tienen dueño:

- toques_seguimiento/fecha_ultimo_toque: los incrementa POST
  /api/webhooks/lead-touch, que llaman los cron de n8n (recordatorios de
  citas, cadencia de seguimiento) después de mandar el mensaje.
- contador_noshow: lo incrementa POST /api/chats/{id}/no-show, una acción
  humana del vendedor — el sistema no puede saber solo si alguien asistió.
"""

from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from routers import chats, webhooks
from models.webhook_schemas import LeadTouchWebhookBody
from tests.conftest import patch_chats, patch_webhooks

LEAD_ID = "7b08f4d9-855f-4718-b95f-9c021da52f77"
JID = "51987654321@s.whatsapp.net"
ADMIN = SimpleNamespace(role="admin", id=1)


@pytest.mark.asyncio
async def test_lead_touch_increments_and_broadcasts(monkeypatch):
    patch_webhooks(monkeypatch, "lead_id_for_jid", AsyncMock(return_value=LEAD_ID))
    record_touch = AsyncMock(return_value=True)
    patch_webhooks(monkeypatch, "record_lead_touch", record_touch)
    broadcast = AsyncMock()
    patch_webhooks(monkeypatch, "manager", SimpleNamespace(broadcast=broadcast))

    result = await webhooks.lead_touch_webhook(LeadTouchWebhookBody(jid=JID))

    record_touch.assert_awaited_once_with(LEAD_ID)
    broadcast.assert_awaited_once_with(
        {"type": "chats_updated", "chat_id": LEAD_ID, "reason": "lead_updated"}
    )
    assert result == {"status": "ok", "chat_id": LEAD_ID}


@pytest.mark.asyncio
async def test_lead_touch_unknown_jid_returns_404(monkeypatch):
    patch_webhooks(monkeypatch, "lead_id_for_jid", AsyncMock(return_value=None))
    record_touch = AsyncMock()
    patch_webhooks(monkeypatch, "record_lead_touch", record_touch)

    with pytest.raises(HTTPException) as exc:
        await webhooks.lead_touch_webhook(LeadTouchWebhookBody(jid=JID))

    assert exc.value.status_code == 404
    record_touch.assert_not_awaited()


@pytest.mark.asyncio
async def test_lead_touch_lead_deleted_between_lookup_and_update_returns_404(monkeypatch):
    """El alias seguía apuntando a un lead que ya no existe (fusión, borrado)."""
    patch_webhooks(monkeypatch, "lead_id_for_jid", AsyncMock(return_value=LEAD_ID))
    patch_webhooks(monkeypatch, "record_lead_touch", AsyncMock(return_value=False))

    with pytest.raises(HTTPException) as exc:
        await webhooks.lead_touch_webhook(LeadTouchWebhookBody(jid=JID))

    assert exc.value.status_code == 404


@pytest.mark.asyncio
async def test_register_no_show_returns_updated_chat(monkeypatch):
    mark_no_show = AsyncMock(return_value={"chat_id": LEAD_ID, "contador_noshow": 1})
    patch_chats(monkeypatch, "mark_lead_no_show", mark_no_show)
    broadcast = AsyncMock()
    patch_chats(monkeypatch, "manager", SimpleNamespace(broadcast=broadcast))

    result = await chats.register_no_show(LEAD_ID, ADMIN)

    mark_no_show.assert_awaited_once_with(LEAD_ID, ADMIN.id)
    broadcast.assert_awaited_once()
    assert result == {"chat_id": LEAD_ID, "contador_noshow": 1}


@pytest.mark.asyncio
async def test_register_no_show_missing_lead_returns_404(monkeypatch):
    patch_chats(monkeypatch, "mark_lead_no_show", AsyncMock(return_value=None))

    with pytest.raises(HTTPException) as exc:
        await chats.register_no_show(LEAD_ID, ADMIN)

    assert exc.value.status_code == 404
