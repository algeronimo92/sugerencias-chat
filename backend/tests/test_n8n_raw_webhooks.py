"""Endpoints que reemplazan a los nodos Postgres directos de rag.json
(get lead1, get messages, buscar mensaje existente1, create lead, guardar
mensajes en posgress). Cada uno preserva el shape que esperaban los nodos
de n8n aguas abajo: objeto vacío cuando el SELECT no encontraba fila."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from app.integrations.n8n import api as webhooks
from tests.conftest import patch_webhooks

LEAD_ID = "7b08f4d9-855f-4718-b95f-9c021da52f77"


@pytest.mark.asyncio
async def test_lead_raw_returns_empty_object_when_not_found(monkeypatch):
    patch_webhooks(monkeypatch, "fetch_lead_raw", AsyncMock(return_value=None))

    result = await webhooks.lead_raw_webhook(chat_id=LEAD_ID)

    assert result == {}


@pytest.mark.asyncio
async def test_lead_raw_returns_the_row_when_found(monkeypatch):
    row = {"id": LEAD_ID, "estado": "nuevo", "ultimo_mensaje_at": "2026-09-03T10:00:00.000000Z"}
    patch_webhooks(monkeypatch, "fetch_lead_raw", AsyncMock(return_value=row))

    result = await webhooks.lead_raw_webhook(chat_id=LEAD_ID)

    assert result == row


@pytest.mark.asyncio
async def test_lead_messages_raw_wraps_the_list(monkeypatch):
    rows = [{"id": 2, "content": "b"}, {"id": 1, "content": "a"}]
    fetch = AsyncMock(return_value=rows)
    patch_webhooks(monkeypatch, "fetch_messages_raw", fetch)

    result = await webhooks.lead_messages_raw_webhook(chat_id=LEAD_ID, limit=500)

    fetch.assert_awaited_once_with(LEAD_ID, limit=500)
    assert result == {"messages": rows}
