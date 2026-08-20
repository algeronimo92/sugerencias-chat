from unittest.mock import AsyncMock

import pytest

from routers import webhooks
from routers.webhooks import OutgoingWebhookBody

LEAD_ID = "7b08f4d9-855f-4718-b95f-9c021da52f77"


@pytest.mark.asyncio
async def test_external_outgoing_is_inserted_and_broadcast(monkeypatch):
    # No hay gemelo de la app: es externo (Kommo/teléfono) -> se inserta.
    reconcile = AsyncMock(return_value={"matched": False, "message_id": 42})
    monkeypatch.setattr(webhooks, "reconcile_outgoing_message", reconcile)
    complete = AsyncMock()
    monkeypatch.setattr(webhooks, "complete_assigned_seller_reply_tasks", complete)
    broadcast = AsyncMock()
    monkeypatch.setattr(webhooks.manager, "broadcast", broadcast)

    result = await webhooks.outgoing_webhook(
        OutgoingWebhookBody(
            chat_id=LEAD_ID,
            message_type="text",
            content="En un momento se conecta un asesor para ayudarlo.",
            wa_message_id="EXT-1",
        )
    )

    reconcile.assert_awaited_once_with(
        LEAD_ID, "text", "En un momento se conecta un asesor para ayudarlo.",
        wa_message_id="EXT-1", media_url=None, payload=None, human_reply=False,
    )
    complete.assert_not_awaited()
    broadcast.assert_awaited_once()
    assert result == {"status": "ok", "matched": False, "message_id": 42}


@pytest.mark.asyncio
async def test_own_echo_is_skipped_without_broadcast(monkeypatch):
    # Ya existe el gemelo de la app: es eco de nuestro envío -> se descarta.
    monkeypatch.setattr(webhooks, "reconcile_outgoing_message", AsyncMock(return_value={"matched": True}))
    complete = AsyncMock()
    monkeypatch.setattr(webhooks, "complete_assigned_seller_reply_tasks", complete)
    broadcast = AsyncMock()
    monkeypatch.setattr(webhooks.manager, "broadcast", broadcast)

    result = await webhooks.outgoing_webhook(
        OutgoingWebhookBody(chat_id=LEAD_ID, content="Hola")
    )

    broadcast.assert_not_awaited()
    complete.assert_not_awaited()
    assert result == {"status": "ok", "matched": True}


@pytest.mark.asyncio
async def test_linked_device_reply_completes_assigned_seller_tasks(monkeypatch):
    reconcile = AsyncMock(return_value={"matched": False, "message_id": 42})
    monkeypatch.setattr(webhooks, "reconcile_outgoing_message", reconcile)
    complete = AsyncMock(return_value=2)
    monkeypatch.setattr(webhooks, "complete_assigned_seller_reply_tasks", complete)
    broadcast = AsyncMock()
    monkeypatch.setattr(webhooks.manager, "broadcast", broadcast)

    result = await webhooks.outgoing_webhook(OutgoingWebhookBody(
        chat_id=LEAD_ID,
        content="Respuesta escrita por la vendedora",
        wa_message_id="PHONE-1",
        source="iOS",
    ))

    reconcile.assert_awaited_once_with(
        LEAD_ID, "text", "Respuesta escrita por la vendedora",
        wa_message_id="PHONE-1", media_url=None, payload={"source": "ios"},
        human_reply=True,
    )
    complete.assert_awaited_once_with(LEAD_ID)
    assert {"type": "tasks_updated"} in [call.args[0] for call in broadcast.await_args_list]
    assert result == {"status": "ok", "matched": False, "message_id": 42}


@pytest.mark.asyncio
async def test_external_automation_does_not_complete_tasks(monkeypatch):
    reconcile = AsyncMock(return_value={"matched": False, "message_id": 43})
    monkeypatch.setattr(webhooks, "reconcile_outgoing_message", reconcile)
    complete = AsyncMock()
    monkeypatch.setattr(webhooks, "complete_assigned_seller_reply_tasks", complete)
    monkeypatch.setattr(webhooks.manager, "broadcast", AsyncMock())

    await webhooks.outgoing_webhook(OutgoingWebhookBody(
        chat_id=LEAD_ID,
        content="Respuesta del bot",
        wa_message_id="BOT-1",
        source="unknown",
    ))

    reconcile.assert_awaited_once_with(
        LEAD_ID, "text", "Respuesta del bot",
        wa_message_id="BOT-1", media_url=None, payload={"source": "unknown"},
        human_reply=False,
    )
    complete.assert_not_awaited()


@pytest.mark.asyncio
async def test_poll_results_update_original_message(monkeypatch):
    update = AsyncMock(return_value={"id": 7})
    monkeypatch.setattr(webhooks, "update_poll_results", update)
    broadcast = AsyncMock()
    monkeypatch.setattr(webhooks.manager, "broadcast", broadcast)

    result = await webhooks.poll_results_webhook(
        webhooks.PollResultsWebhookBody(
            chat_id=LEAD_ID,
            target_wa_message_id="POLL-1",
            results=[{"option": "AM", "count": 2, "voters": []}],
            voter_id="cliente-1",
            mode="snapshot",
        )
    )

    update.assert_awaited_once_with(
        LEAD_ID, "POLL-1", [{"option": "AM", "count": 2, "voters": []}],
        voter_id="cliente-1",
        mode="snapshot",
    )
    broadcast.assert_awaited_once()
    assert result == {"status": "ok", "matched": True}


@pytest.mark.asyncio
async def test_encrypted_poll_update_is_ignored_without_erasing_results(monkeypatch):
    update = AsyncMock()
    monkeypatch.setattr(webhooks, "update_poll_results", update)

    result = await webhooks.poll_results_webhook(
        webhooks.PollResultsWebhookBody(
            chat_id=LEAD_ID, target_wa_message_id="POLL-1", results=[], decrypted=False
        )
    )

    update.assert_not_awaited()
    assert result == {"status": "ok", "matched": False, "ignored": "encrypted_or_empty"}
