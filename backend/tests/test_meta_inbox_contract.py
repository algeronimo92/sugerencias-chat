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


@pytest.mark.parametrize("missing", ["event_key", "event_type"])
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


def test_meta_inbox_accepts_waba_for_account_level_events() -> None:
    event = MetaInboxEvent(
        event_key="WABA_1:template_sync:template_category_update:META_1:123",
        event_type="template_sync",
        waba_id="WABA_1",
        payload={"_kind": "template_sync", "meta_template_id": "META_1"},
    )
    assert event.phone_number_id is None
    assert event.waba_id == "WABA_1"


def test_meta_inbox_rejects_event_without_any_routing_identity() -> None:
    with pytest.raises(ValidationError):
        MetaInboxEvent(
            event_key="template-sync:no-route",
            event_type="template_sync",
            payload={},
        )


def test_meta_inbox_rejects_unbounded_batches() -> None:
    event = {
        "event_key": "message:wamid.test",
        "event_type": "message",
        "phone_number_id": "123456",
        "payload": {},
    }
    with pytest.raises(ValidationError):
        MetaInboxBatch(events=[event] * 101)
