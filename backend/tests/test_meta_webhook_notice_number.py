"""El número de avisos de cita es otro número de la misma WABA: Meta manda sus
estados de entrega y lo que le escriben al mismo webhook. Los estados sirven
para el historial de avisos; los mensajes no deben abrir chats en el CRM."""

from unittest.mock import AsyncMock

from app.integrations.meta_webhook import processor


def _change(phone_number_id: str) -> dict:
    return {
        "field": "messages",
        "value": {
            "metadata": {"phone_number_id": phone_number_id},
            "statuses": [{"id": "wamid.aviso", "status": "read"}],
            "messages": [{"id": "wamid.respuesta", "from": "51955090027", "type": "text"}],
        },
    }


def _patch(monkeypatch, notice_number: str):
    statuses, messages = AsyncMock(), AsyncMock()
    monkeypatch.setattr(processor, "get_effective_many", AsyncMock(
        side_effect=lambda keys: {key: notice_number for key in keys},
    ))
    monkeypatch.setattr(processor, "_status", statuses)
    monkeypatch.setattr(processor, "_conversation_message", messages)
    return statuses, messages


async def test_messages_to_the_notice_number_do_not_open_chats(monkeypatch):
    statuses, messages = _patch(monkeypatch, notice_number="AVISOS_ID")

    await processor._messages_change(_change("AVISOS_ID"), "evt-1")

    statuses.assert_awaited_once()
    messages.assert_not_awaited()


async def test_messages_to_the_crm_number_still_open_chats(monkeypatch):
    statuses, messages = _patch(monkeypatch, notice_number="AVISOS_ID")

    await processor._messages_change(_change("CRM_ID"), "evt-1")

    statuses.assert_awaited_once()
    messages.assert_awaited_once()


async def test_without_a_notice_number_everything_is_processed(monkeypatch):
    _statuses, messages = _patch(monkeypatch, notice_number="")

    await processor._messages_change(_change("CRM_ID"), "evt-1")

    messages.assert_awaited_once()
