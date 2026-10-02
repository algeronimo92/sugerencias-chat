from unittest.mock import AsyncMock
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.modules.conversations.schemas import SendMessageRequest
from app.modules.conversations import api as chats
from app.modules.conversations import message_outbox
from tests.conftest import open_service_window, patch_chats
from app.modules.conversations.outbound_api import _resolve_reply_to

CHAT_ID = "7b08f4d9-855f-4718-b95f-9c021da52f77"
USER = SimpleNamespace(id=7)


@pytest.mark.asyncio
async def test_la_cita_viaja_como_context_de_meta(monkeypatch):
    """Meta solo necesita el wa_message_id del citado en ``context``."""
    monkeypatch.setattr(message_outbox, "require_capabilities", AsyncMock())
    prepared = await message_outbox.prepare_items([{
        "message": {"type": "text", "text": {"body": "Sale 200"}},
        "reply_to": {"id": 5, "sender": "cliente", "content": "¿Cuánto?", "wa_message_id": "WA-2"},
    }])

    assert prepared[0]["message"] == {
        "type": "text", "text": {"body": "Sale 200"}, "context": {"message_id": "WA-2"},
    }


@pytest.mark.asyncio
async def test_responder_a_un_mensaje_inexistente_es_404(monkeypatch):
    patch_chats(monkeypatch, "fetch_reply_target", AsyncMock(return_value=None))

    with pytest.raises(HTTPException) as error:
        await _resolve_reply_to(CHAT_ID, 42)

    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_responder_a_un_mensaje_aun_en_la_outbox_es_409(monkeypatch):
    """Sin wa_message_id no hay cita posible. Se avisa en vez de enviar el
    mensaje suelto: quien respondió esperaba ver el recuadro."""
    patch_chats(monkeypatch, "fetch_reply_target", AsyncMock(return_value={
        "id": 42, "sender": "vendedor", "content": "Ahí va", "wa_message_id": None,
    }))

    with pytest.raises(HTTPException) as error:
        await _resolve_reply_to(CHAT_ID, 42)

    assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_el_texto_se_encola_con_el_mensaje_citado(monkeypatch):
    target = {"id": 42, "sender": "cliente", "content": "¿Cuánto sale?", "wa_message_id": "WA-2"}
    patch_chats(monkeypatch, "_require_existing_lead", AsyncMock())
    open_service_window(monkeypatch)
    patch_chats(monkeypatch, "fetch_reply_target", AsyncMock(return_value=target))
    enqueue = AsyncMock(return_value=[{"id": 90, "outbox_status": "queued"}])
    patch_chats(monkeypatch, "enqueue_messages", enqueue)
    patch_chats(monkeypatch, "manager", SimpleNamespace(broadcast=AsyncMock()))

    await chats.send_message(CHAT_ID, SendMessageRequest(text="Sale 200", reply_to_message_id=42), USER)

    enqueue.assert_awaited_once_with(
        CHAT_ID,
        [{"content": "Sale 200", "message": {"type": "text", "text": {"body": "Sale 200"}}, "reply_to": target}],
        actor_user_id=USER.id,
    )
