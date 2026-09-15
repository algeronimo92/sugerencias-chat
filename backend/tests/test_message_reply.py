from unittest.mock import AsyncMock
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from models.schemas import SendMessageRequest
from routers import chats
from services import message_outbox
from services.outbound_kinds import send_outbound
from tests.conftest import FakeSender

USER = SimpleNamespace(id=7)


def test_quoted_context_lleva_el_wa_message_id_del_original():
    """Meta solo necesita el wa_message_id del mensaje citado -a diferencia
    de Evolution/Baileys, no hace falta armar una key/message falsa con el
    texto recortado: la Graph API resuelve el resto del lado del cliente."""
    quoted = message_outbox.quoted_context({
        "id": 5, "sender": "vendedor", "content": "Te paso el precio",
        "wa_message_id": "WA-1",
    })

    assert quoted == {"wa_message_id": "WA-1"}


@pytest.mark.asyncio
async def test_el_envio_lleva_la_cita_al_canal():
    sender = FakeSender()
    quoted = {"wa_message_id": "WA-2"}

    await send_outbound(sender, "51999@s.whatsapp.net", {
        "type": "text", "text": "Sale 200", "quoted": quoted,
    })

    assert sender.only_call() == ("send_text", ("51999@s.whatsapp.net", "Sale 200"), {"quoted": quoted})


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
