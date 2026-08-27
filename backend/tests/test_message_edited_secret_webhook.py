import base64
from unittest.mock import AsyncMock

import pytest

from routers import webhooks
from routers.webhooks import MessageEditedSecretWebhookBody

LEAD_ID = "7b08f4d9-855f-4718-b95f-9c021da52f77"


@pytest.mark.asyncio
async def test_decrypted_edit_updates_message_and_broadcasts(monkeypatch):
    update = AsyncMock(return_value={"id": 42, "content": "precio correcto: 450"})
    monkeypatch.setattr(webhooks, "update_message_content_from_secret", update)
    broadcast = AsyncMock()
    monkeypatch.setattr(webhooks.manager, "broadcast", broadcast)

    result = await webhooks.message_edited_secret_webhook(
        MessageEditedSecretWebhookBody(
            chat_id=LEAD_ID,
            wa_message_id="WA-EDITED",
            sender_candidates=["51999@lid", "51999@s.whatsapp.net"],
            enc_payload=base64.b64encode(b"ciphertext-fake").decode(),
            enc_iv=base64.b64encode(b"iv-fake-1234").decode(),
        )
    )

    update.assert_awaited_once_with(
        LEAD_ID, "WA-EDITED", ["51999@lid", "51999@s.whatsapp.net"], b"ciphertext-fake", b"iv-fake-1234"
    )
    broadcast.assert_awaited_once_with(
        {"type": "chats_updated", "chat_id": LEAD_ID, "reason": "message_edited"}
    )
    assert result == {"status": "ok", "matched": True}


@pytest.mark.asyncio
async def test_unknown_message_returns_matched_false_without_error(monkeypatch):
    # El mensaje editado no está en la base (histórico previo a la
    # integración): igual que el webhook hermano, 200 con matched=False, no 404.
    monkeypatch.setattr(webhooks, "update_message_content_from_secret", AsyncMock(return_value=None))
    broadcast = AsyncMock()
    monkeypatch.setattr(webhooks.manager, "broadcast", broadcast)

    result = await webhooks.message_edited_secret_webhook(
        MessageEditedSecretWebhookBody(
            chat_id=LEAD_ID,
            wa_message_id="WA-UNKNOWN",
            sender_candidates=["51999@lid"],
            enc_payload=base64.b64encode(b"ciphertext-fake").decode(),
            enc_iv=base64.b64encode(b"iv-fake-1234").decode(),
        )
    )

    broadcast.assert_not_awaited()
    assert result == {"status": "ok", "matched": False}


@pytest.mark.asyncio
async def test_failed_decryption_returns_matched_false_without_error(monkeypatch):
    # Descifrado fallido (secreto no capturado, ningún sender válido) es
    # esperado, no un error de servidor.
    monkeypatch.setattr(webhooks, "update_message_content_from_secret", AsyncMock(return_value=None))
    broadcast = AsyncMock()
    monkeypatch.setattr(webhooks.manager, "broadcast", broadcast)

    result = await webhooks.message_edited_secret_webhook(
        MessageEditedSecretWebhookBody(
            chat_id=LEAD_ID,
            wa_message_id="WA-EDITED",
            sender_candidates=["51999@lid"],
            enc_payload=base64.b64encode(b"ciphertext-fake").decode(),
            enc_iv=base64.b64encode(b"iv-fake-1234").decode(),
        )
    )

    assert result == {"status": "ok", "matched": False}


@pytest.mark.asyncio
async def test_malformed_base64_returns_matched_false_without_error(monkeypatch):
    update = AsyncMock()
    monkeypatch.setattr(webhooks, "update_message_content_from_secret", update)
    broadcast = AsyncMock()
    monkeypatch.setattr(webhooks.manager, "broadcast", broadcast)

    result = await webhooks.message_edited_secret_webhook(
        MessageEditedSecretWebhookBody(
            chat_id=LEAD_ID,
            wa_message_id="WA-EDITED",
            sender_candidates=["51999@lid"],
            enc_payload="no-es-base64-válido!!",
            enc_iv=base64.b64encode(b"iv-fake-1234").decode(),
        )
    )

    update.assert_not_awaited()
    broadcast.assert_not_awaited()
    assert result == {"status": "ok", "matched": False}
