from domain_types import MessageStatus
from services.message_status_service import parse_message_status_updates


def test_accepts_existing_flat_n8n_contract():
    assert parse_message_status_updates({
        "wa_message_id": "WA-1",
        "status": "read",
    }) == [("WA-1", MessageStatus.READ)]


def test_accepts_native_evolution_event_with_named_status():
    payload = {
        "event": "messages.update",
        "instance": "dermica",
        "data": {
            "key": {"id": "WA-2", "fromMe": True},
            "status": "DELIVERY_ACK",
        },
    }

    assert parse_message_status_updates(payload) == [
        ("WA-2", MessageStatus.DELIVERY_ACK),
    ]


def test_accepts_numeric_status_nested_in_update():
    payload = {
        "event": "MESSAGES_UPDATE",
        "data": {
            "key": {"id": "WA-3", "fromMe": True},
            "update": {"status": 4},
        },
    }

    assert parse_message_status_updates(payload) == [("WA-3", MessageStatus.READ)]


def test_accepts_n8n_body_wrapper():
    payload = {
        "body": {
            "event": "messages.update",
            "data": {"key": {"id": "WA-N8N"}, "status": "READ"},
        }
    }

    assert parse_message_status_updates(payload) == [("WA-N8N", MessageStatus.READ)]


def test_prefers_whatsapp_key_id_over_evolution_database_id():
    payload = {
        "data": {
            "keyId": "WA-KEY-ID",
            "messageId": "evolution-database-id",
            "status": "READ",
        }
    }

    assert parse_message_status_updates(payload) == [("WA-KEY-ID", MessageStatus.READ)]


def test_batch_keeps_most_advanced_status_and_ignores_pending():
    payload = {
        "data": [
            {"key": {"id": "WA-4"}, "status": 3},
            {"key": {"id": "WA-4"}, "status": 5},
            {"key": {"id": "WA-5"}, "status": 1},
        ]
    }

    assert parse_message_status_updates(payload) == [("WA-4", MessageStatus.PLAYED)]
