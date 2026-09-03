"""Endpoints que reemplazan a los nodos Postgres directos de rag.json
(get lead1, get messages, buscar mensaje existente1, create lead, guardar
mensajes en posgress). Cada uno preserva el shape que esperaban los nodos
de n8n aguas abajo: objeto vacío cuando el SELECT no encontraba fila."""

from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest

from routers import webhooks
from routers.webhooks import EnsureLeadWebhookBody, SaveInboundMessageWebhookBody

LEAD_ID = "7b08f4d9-855f-4718-b95f-9c021da52f77"


@pytest.mark.asyncio
async def test_lead_raw_returns_empty_object_when_not_found(monkeypatch):
    monkeypatch.setattr(webhooks, "fetch_lead_raw", AsyncMock(return_value=None))

    result = await webhooks.lead_raw_webhook(chat_id=LEAD_ID)

    assert result == {}


@pytest.mark.asyncio
async def test_lead_raw_returns_the_row_when_found(monkeypatch):
    row = {"id": LEAD_ID, "estado": "nuevo", "ultimo_mensaje_at": "2026-09-03T10:00:00.000000Z"}
    monkeypatch.setattr(webhooks, "fetch_lead_raw", AsyncMock(return_value=row))

    result = await webhooks.lead_raw_webhook(chat_id=LEAD_ID)

    assert result == row


@pytest.mark.asyncio
async def test_lead_messages_raw_wraps_the_list(monkeypatch):
    rows = [{"id": 2, "content": "b"}, {"id": 1, "content": "a"}]
    fetch = AsyncMock(return_value=rows)
    monkeypatch.setattr(webhooks, "fetch_messages_raw", fetch)

    result = await webhooks.lead_messages_raw_webhook(chat_id=LEAD_ID, limit=500)

    fetch.assert_awaited_once_with(LEAD_ID, limit=500)
    assert result == {"messages": rows}


@pytest.mark.asyncio
async def test_message_by_wa_id_raw_returns_empty_object_when_not_found(monkeypatch):
    monkeypatch.setattr(webhooks, "fetch_message_by_wa_id", AsyncMock(return_value=None))

    result = await webhooks.message_by_wa_id_raw_webhook(wa_message_id="ABC-1")

    assert result == {}


@pytest.mark.asyncio
async def test_message_by_wa_id_raw_returns_the_row_when_found(monkeypatch):
    row = {"id": 42, "wa_message_id": "ABC-1"}
    monkeypatch.setattr(webhooks, "fetch_message_by_wa_id", AsyncMock(return_value=row))

    result = await webhooks.message_by_wa_id_raw_webhook(wa_message_id="ABC-1")

    assert result == row


@pytest.mark.asyncio
async def test_ensure_lead_forwards_to_the_service(monkeypatch):
    stub = AsyncMock(return_value={"id": LEAD_ID, "estado": "nuevo"})
    monkeypatch.setattr(webhooks, "ensure_lead_stub", stub)

    result = await webhooks.ensure_lead_webhook(
        EnsureLeadWebhookBody(chat_id=LEAD_ID, ultimo_mensaje_at="2026-09-03T10:00:00Z", origen="Facebook Ads")
    )

    stub.assert_awaited_once_with(
        LEAD_ID, datetime(2026, 9, 3, 10, 0, 0, tzinfo=timezone.utc), "Facebook Ads"
    )
    assert result == {"id": LEAD_ID, "estado": "nuevo"}


@pytest.mark.asyncio
async def test_save_inbound_message_parses_timestamp_and_secret(monkeypatch):
    insert = AsyncMock(return_value={"id": 99, "wa_message_id": "IN-1"})
    monkeypatch.setattr(webhooks, "insert_message", insert)

    body = SaveInboundMessageWebhookBody(
        chat_id=LEAD_ID,
        sender="cliente",
        content="Hola",
        sent_at="2026-09-03T10:00:00Z",
        wa_message_id="IN-1",
        media_width=0,
        media_height=0,
        message_secret="aGVsbG8=",  # base64("hello")
    )

    result = await webhooks.save_inbound_message_webhook(body)

    insert.assert_awaited_once()
    args, kwargs = insert.await_args
    assert args == (LEAD_ID, "cliente", "Hola")
    assert kwargs["wa_message_id"] == "IN-1"
    assert kwargs["media_width"] == 0
    assert kwargs["media_height"] == 0
    assert kwargs["message_secret"] == b"hello"
    assert kwargs["sent_at"] == datetime(2026, 9, 3, 10, 0, 0, tzinfo=timezone.utc)
    assert result == {"id": 99, "wa_message_id": "IN-1"}


@pytest.mark.asyncio
async def test_save_inbound_message_tolerates_missing_optional_fields(monkeypatch):
    insert = AsyncMock(return_value={"id": 100})
    monkeypatch.setattr(webhooks, "insert_message", insert)

    body = SaveInboundMessageWebhookBody(chat_id=LEAD_ID, sender="cliente", content="Hola")

    await webhooks.save_inbound_message_webhook(body)

    args, kwargs = insert.await_args
    assert kwargs["sent_at"] is None
    assert kwargs["message_secret"] is None
