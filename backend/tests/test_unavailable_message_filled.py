"""131060: en coexistencia Meta manda primero "mensaje no disponible" y, segundos
después, el mismo id con el contenido. Pasó en DermicaPro con el primer mensaje
de un anuncio: el CRM descartaba la segunda entrega y el texto quedaba solo en
el celular."""

from app.modules.conversations.application.inbound import receive_provider_message
from app.modules.conversations.domain.events import ProviderMessageChanged, ProviderMessageStored

WAMID = "wamid.PRIMERO"
NOTICE = {
    "id": WAMID, "from": "51922222222", "type": "unsupported",
    "errors": [{"code": 131060, "title": "This message is unavailable."}],
}
REAL = {"id": WAMID, "from": "51922222222", "type": "text", "text": {"body": "Quiero más información"}}


async def _receive(message: dict, *, content: str | None, event: str):
    return await receive_provider_message(
        chat_id="lead-1", sender="cliente", wa_message_id=WAMID, message_type=message["type"],
        message_subtype=None, provider_payload=message, content=content, sent_at=None,
        quoted_wa_message_id=None, webhook_event_id=event,
    )


async def test_the_real_content_replaces_the_unavailable_notice(in_memory_conversations):
    await _receive(NOTICE, content=None, event="e1")

    stored, created = await _receive(REAL, content="Quiero más información", event="e2")

    assert created is True
    assert (stored["message_type"], stored["content"]) == ("text", "Quiero más información")
    assert len(in_memory_conversations.messages.stored) == 1
    [changed] = in_memory_conversations.of(ProviderMessageChanged)
    assert changed.change == "filled"
    # Las automatizaciones ya corrieron con el aviso: no se repiten.
    assert len(in_memory_conversations.of(ProviderMessageStored)) == 1


async def test_a_repeated_delivery_of_a_normal_message_changes_nothing(in_memory_conversations):
    await _receive(REAL, content="Quiero más información", event="e1")

    stored, created = await _receive(REAL, content="otro", event="e2")

    assert created is False
    assert stored["content"] == "Quiero más información"
    assert in_memory_conversations.of(ProviderMessageChanged) == []


async def test_another_unavailable_notice_does_not_count_as_content(in_memory_conversations):
    await _receive(NOTICE, content=None, event="e1")

    _stored, created = await _receive(NOTICE, content=None, event="e2")

    assert created is False
    assert in_memory_conversations.of(ProviderMessageChanged) == []
