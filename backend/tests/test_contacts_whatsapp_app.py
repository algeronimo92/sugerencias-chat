"""Lectura de los webhooks de la app WhatsApp Business del celular
(coexistencia): cambios de la agenda e historial. Sin base de datos."""

from __future__ import annotations

from datetime import datetime, timezone

from app.modules.contacts.whatsapp_app import contact_changes, history_chunks


def _state(*items):
    return {"messaging_product": "whatsapp", "metadata": {"phone_number_id": "PN"}, "state_sync": list(items)}


def test_contact_changes_come_in_time_order_and_without_unknowns():
    value = _state(
        {"type": "contact", "action": "remove", "contact": {"user_id": "US.1", "phone_number": "51987654321"},
         "metadata": {"timestamp": "1700000200"}},
        {"type": "contact", "action": "add",
         "contact": {"full_name": "Ana Ruiz", "first_name": "Ana", "user_id": "US.1", "phone_number": "51987654321"},
         "metadata": {"timestamp": "1700000100"}},
        {"type": "contact", "action": "add", "contact": {"full_name": "Sin identidad"}},
        {"type": "label", "action": "add", "contact": {"user_id": "US.2"}},
    )

    changes = contact_changes(value)

    assert [change.action for change in changes] == ["add", "remove"]
    assert changes[0].nombre == "Ana Ruiz"
    assert changes[0].telefono == "51987654321"
    assert changes[0].changed_at == datetime.fromtimestamp(1700000100, tz=timezone.utc)
    assert changes[1].nombre is None


def test_history_threads_know_who_talked_and_when():
    value = {"history": [{
        "metadata": {"phase": 1, "chunk_order": 2, "progress": 55},
        "threads": [
            {"id": "51987654321", "messages": [
                {"from": "51987654321", "from_user_id": "US.9", "timestamp": "1700000000"},
                {"from": "51900000000", "to": "51987654321", "timestamp": "1700000500"},
            ]},
            {"id": "not-a-phone", "messages": []},
        ],
    }]}

    [chunk] = history_chunks(value)

    assert (chunk.phase, chunk.chunk_order, chunk.progress, chunk.declined) == (1, 2, 55, False)
    [thread] = chunk.threads
    assert thread.telefono == "51987654321"
    assert thread.wa_user_id == "US.9"
    assert thread.last_message_at == datetime.fromtimestamp(1700000500, tz=timezone.utc)


def test_history_declined_by_the_business_is_recognized():
    value = {"history": [{"errors": [{"code": 2593109, "title": "History sync is turned off"}]}]}

    [chunk] = history_chunks(value)

    assert chunk.declined is True
    assert chunk.threads == []
