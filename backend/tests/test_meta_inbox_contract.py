import pytest
from pydantic import ValidationError

from routers.webhooks.inbox import MetaInboxBatch, MetaInboxEvent


def test_meta_inbox_requires_stable_routing_and_event_identity() -> None:
    event = MetaInboxEvent(
        event_key="message:wamid.test",
        event_type="message",
        phone_number_id="123456",
        payload={"_kind": "message", "wa_message_id": "wamid.test"},
    )
    body = MetaInboxBatch(events=[event])
    assert body.events[0].phone_number_id == "123456"


@pytest.mark.parametrize("missing", ["event_key", "event_type", "phone_number_id"])
def test_meta_inbox_rejects_missing_identity_fields(missing: str) -> None:
    values = {
        "event_key": "message:wamid.test",
        "event_type": "message",
        "phone_number_id": "123456",
        "payload": {},
    }
    values.pop(missing)
    with pytest.raises(ValidationError):
        MetaInboxEvent(**values)


def test_meta_inbox_rejects_unbounded_batches() -> None:
    event = {
        "event_key": "message:wamid.test",
        "event_type": "message",
        "phone_number_id": "123456",
        "payload": {},
    }
    with pytest.raises(ValidationError):
        MetaInboxBatch(events=[event] * 101)
