import pytest

from routers.webhooks import templates
from services.template_service import _meta_managed_template_values


@pytest.mark.asyncio
async def test_template_put_fetches_full_meta_state_replaces_and_broadcasts(monkeypatch) -> None:
    remote = {
        "id": "META_1",
        "name": "recordatorio_cita",
        "language": "es",
        "category": "MARKETING",
        "status": "APPROVED",
        "components": [{"type": "BODY", "text": "Contenido recategorizado"}],
    }
    received = None
    broadcast = None

    async def fake_get(meta_template_id):
        assert meta_template_id == "META_1"
        return remote

    async def fake_replace(meta_template_id, representation):
        nonlocal received
        received = (meta_template_id, representation)
        return [7]

    async def fake_broadcast(payload):
        nonlocal broadcast
        broadcast = payload

    monkeypatch.setattr(templates, "get_whatsapp_template", fake_get)
    monkeypatch.setattr(templates, "replace_official_template_from_meta", fake_replace)
    monkeypatch.setattr(templates.manager, "broadcast", fake_broadcast)

    result = await templates.replace_template_from_meta_webhook("META_1")

    assert received == ("META_1", remote)
    assert broadcast == {
        "type": "templates_updated",
        "template_ids": [7],
        "source": "meta_webhook",
    }
    assert result == {"status": "ok", "matched": True, "updated_count": 1}


@pytest.mark.asyncio
async def test_template_put_unlinked_event_is_acknowledged_without_broadcast(monkeypatch) -> None:
    async def fake_get(_meta_template_id):
        return {"id": "META_EXTERNAL", "components": []}

    async def fake_replace(_meta_template_id, _remote):
        return []

    async def unexpected_broadcast(_payload):
        raise AssertionError("No debe emitir si no existe una plantilla local vinculada")

    monkeypatch.setattr(templates, "get_whatsapp_template", fake_get)
    monkeypatch.setattr(templates, "replace_official_template_from_meta", fake_replace)
    monkeypatch.setattr(templates.manager, "broadcast", unexpected_broadcast)

    result = await templates.replace_template_from_meta_webhook("META_EXTERNAL")

    assert result == {"status": "ok", "matched": False, "updated_count": 0}


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
