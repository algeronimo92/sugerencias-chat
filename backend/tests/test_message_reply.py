from unittest.mock import AsyncMock
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from models.schemas import SendMessageRequest
from routers import chats
from services import message_outbox

USER = SimpleNamespace(id=7)


def test_quoted_context_marca_de_quien_era_el_mensaje_citado():
    """`fromMe` es lo que le permite a WhatsApp encontrar el original: si va
    mal, el mensaje se envía pero llega sin el recuadro de la cita."""
    propio = message_outbox.quoted_context("51999@s.whatsapp.net", {
        "id": 5, "sender": "vendedor", "content": "Te paso el precio",
        "wa_message_id": "WA-1",
    })
    del_cliente = message_outbox.quoted_context("51999@s.whatsapp.net", {
        "id": 6, "sender": "cliente", "content": "¿Cuánto sale?",
        "wa_message_id": "WA-2",
    })

    assert propio["key"] == {
        "remoteJid": "51999@s.whatsapp.net", "fromMe": True, "id": "WA-1",
    }
    assert propio["message"] == {"conversation": "Te paso el precio"}
    assert del_cliente["key"]["fromMe"] is False


def test_quoted_context_recorta_la_vista_previa():
    quoted = message_outbox.quoted_context("51999@s.whatsapp.net", {
        "id": 7, "sender": "cliente", "content": "x" * 500, "wa_message_id": "WA-3",
    })

    assert len(quoted["message"]["conversation"]) == message_outbox.QUOTED_PREVIEW_MAX


def test_quoted_context_tolera_un_citado_sin_texto():
    """Un audio o una imagen sin epígrafe tienen content None en la base."""
    quoted = message_outbox.quoted_context("51999@s.whatsapp.net", {
        "id": 8, "sender": "cliente", "content": None, "wa_message_id": "WA-4",
    })

    assert quoted["message"] == {"conversation": ""}


@pytest.mark.asyncio
async def test_el_envio_lleva_la_cita_a_evolution(monkeypatch):
    send_text = AsyncMock(return_value={"key": {"id": "WA-OUT"}})
    monkeypatch.setattr(message_outbox, "send_whatsapp_text", send_text)
    quoted = {"key": {"remoteJid": "51999@s.whatsapp.net", "fromMe": False, "id": "WA-2"}}

    await message_outbox._send_payload("51999@s.whatsapp.net", {
        "type": "text", "text": "Sale 200", "quoted": quoted,
    })

    send_text.assert_awaited_once_with("51999@s.whatsapp.net", "Sale 200", quoted=quoted)


@pytest.mark.asyncio
async def test_responder_a_un_mensaje_inexistente_es_404(monkeypatch):
    monkeypatch.setattr(chats, "fetch_reply_target", AsyncMock(return_value=None))

    with pytest.raises(HTTPException) as error:
        await chats._resolve_reply_to("51999@s.whatsapp.net", 42)

    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_responder_a_un_mensaje_aun_en_la_outbox_es_409(monkeypatch):
    """Sin wa_message_id no hay cita posible. Se avisa en vez de enviar el
    mensaje suelto: quien respondió esperaba ver el recuadro."""
    monkeypatch.setattr(chats, "fetch_reply_target", AsyncMock(return_value={
        "id": 42, "sender": "vendedor", "content": "Ahí va", "wa_message_id": None,
    }))

    with pytest.raises(HTTPException) as error:
        await chats._resolve_reply_to("51999@s.whatsapp.net", 42)

    assert error.value.status_code == 409


@pytest.mark.asyncio
async def test_el_texto_se_encola_con_el_mensaje_citado(monkeypatch):
    target = {"id": 42, "sender": "cliente", "content": "¿Cuánto sale?", "wa_message_id": "WA-2"}
    monkeypatch.setattr(chats, "_require_existing_lead", AsyncMock())
    monkeypatch.setattr(chats, "fetch_reply_target", AsyncMock(return_value=target))
    enqueue = AsyncMock(return_value={"id": 90, "status": "PENDING"})
    monkeypatch.setattr(chats, "enqueue_text_message", enqueue)
    monkeypatch.setattr(chats.manager, "broadcast", AsyncMock())

    await chats.send_message(
        "51999999999@s.whatsapp.net",
        SendMessageRequest(text="Sale 200", reply_to_message_id=42),
        USER,
    )

    enqueue.assert_awaited_once_with(
        "51999999999@s.whatsapp.net", "Sale 200", target, actor_user_id=USER.id,
    )
