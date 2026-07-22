from scripts.backfill_message_senders import extract_sender
from db.models import WspMessage


def test_wsp_message_sender_is_not_nullable():
    assert WspMessage.__table__.c.sender.nullable is False


def test_extract_sender_maps_evolution_from_me_true_to_seller():
    payload = {
        "messages": {
            "records": [{"key": {"id": "message-1", "fromMe": True}}]
        }
    }

    assert extract_sender(payload, "message-1") == "vendedor"


def test_extract_sender_maps_evolution_from_me_false_to_customer():
    payload = [
        {"data": {"key": {"id": "message-2", "fromMe": False}}}
    ]

    assert extract_sender(payload, "message-2") == "cliente"


def test_extract_sender_ignores_other_messages_and_non_boolean_values():
    payload = {
        "records": [
            {"key": {"id": "another-message", "fromMe": True}},
            {"key": {"id": "message-3", "fromMe": "false"}},
        ]
    }

    assert extract_sender(payload, "message-3") is None


def test_extract_sender_rejects_conflicting_matches():
    payload = {
        "records": [
            {"key": {"id": "message-4", "fromMe": True}},
            {"key": {"id": "message-4", "fromMe": False}},
        ]
    }

    assert extract_sender(payload, "message-4") is None
