"""Cambios de plantillas que Meta informa por webhook (field de la WABA)."""

import pytest

from app.integrations.meta_webhook import processor
from app.integrations.meta_webhook.inbox import InboxEvent, split_changes
from app.modules.catalogs.template_service import _meta_managed_template_values
from tests.meta_fixtures import WABA_ID, webhook_body
from app.realtime import ws_manager


def _template_event(field: str, value: dict) -> InboxEvent:
    change = split_changes(webhook_body(value, field=field))[0]
    return InboxEvent(id="evt-1", event_type=field, payload=change, attempts=1)


@pytest.mark.parametrize(
    "field", ["message_template_status_update", "template_category_update", "message_template_components_update"]
)
@pytest.mark.asyncio
async def test_template_change_fetches_full_meta_state_replaces_and_broadcasts(monkeypatch, field) -> None:
    remote = {
        "id": "META_1",
        "name": "recordatorio_cita",
        "language": "es",
        "category": "MARKETING",
        "status": "APPROVED",
        "components": [{"type": "BODY", "text": "Contenido recategorizado"}],
    }
    received = None
    broadcasts = []

    async def fake_get(meta_template_id):
        assert meta_template_id == "META_1"
        return remote

    async def fake_replace(meta_template_id, representation):
        nonlocal received
        received = (meta_template_id, representation)
        return [7]

    async def fake_broadcast(payload):
        broadcasts.append(payload)

    monkeypatch.setattr(processor.meta_service, "get_whatsapp_template", fake_get)
    monkeypatch.setattr(processor, "replace_official_template_from_meta", fake_replace)
    monkeypatch.setattr(ws_manager.manager, "broadcast", fake_broadcast)

    event = _template_event(field, {"event": "APPROVED", "message_template_id": "META_1"})
    assert event.payload["entry_id"] == WABA_ID
    await processor.process_change(event)

    assert received == ("META_1", remote)
    assert broadcasts == [{"type": "templates_updated", "template_ids": [7], "source": "meta_webhook"}]


@pytest.mark.asyncio
async def test_template_change_unlinked_is_acknowledged_without_broadcast(monkeypatch) -> None:
    async def fake_get(_meta_template_id):
        return {"id": "META_EXTERNAL", "components": []}

    async def fake_replace(_meta_template_id, _remote):
        return []

    async def unexpected_broadcast(_payload):
        raise AssertionError("No debe emitir si no existe una plantilla local vinculada")

    monkeypatch.setattr(processor.meta_service, "get_whatsapp_template", fake_get)
    monkeypatch.setattr(processor, "replace_official_template_from_meta", fake_replace)
    monkeypatch.setattr(ws_manager.manager, "broadcast", unexpected_broadcast)

    await processor.process_change(
        _template_event("message_template_status_update", {"message_template_id": "META_EXTERNAL"})
    )


def test_full_meta_mapper_replaces_category_status_content_and_components() -> None:
    values = _meta_managed_template_values(
        {
            "name": "promo",
            "language": "es_PE",
            "category": "MARKETING",
            "status": "REJECTED",
            "rejected_reason": "TAG_CONTENT_MISMATCH",
            "components": [
                {"type": "HEADER", "format": "TEXT", "text": "Nueva cabecera"},
                {"type": "BODY", "text": "Nuevo cuerpo {{1}}"},
                {"type": "FOOTER", "text": "Nuevo pie"},
                {
                    "type": "BUTTONS",
                    "buttons": [{"type": "URL", "text": "Ver", "url": "https://example.test"}],
                },
            ],
        },
        current_header_media_asset_id=44,
    )

    assert values["official_name"] == "promo"
    assert values["official_language"] == "es_PE"
    assert values["official_category"] == "MARKETING"
    assert values["official_status"] == "REJECTED"
    assert values["official_rejected_reason"] == "TAG_CONTENT_MISMATCH"
    assert values["content"] == "Nuevo cuerpo {{1}}"
    assert values["official_header_type"] == "text"
    assert values["official_header_text"] == "Nueva cabecera"
    assert values["official_header_media_asset_id"] is None
    assert values["official_footer"] == "Nuevo pie"
    assert values["official_buttons"] == [
        {"type": "url", "text": "Ver", "url": "https://example.test"}
    ]
