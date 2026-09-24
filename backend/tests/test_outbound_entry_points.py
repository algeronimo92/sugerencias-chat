from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from models.schemas import (
    ContactShareItem,
    SendContactsRequest,
    SendInteractiveRequest,
    SendTemplateRequest,
    StickerRequest,
)
from routers import chats
from services import chat_messaging
from services.meta_outbound import OutboundRejected
from tests.conftest import open_service_window, patch_chats
from tests.meta_fixtures import outbound_cases
from routers.chats.outbound import TEMPLATE_ERROR_STATUS

SELLER = SimpleNamespace(id=7, role="vendedor")
CHAT_ID = "7b08f4d9-855f-4718-b95f-9c021da52f77"


@pytest.fixture
def broadcast(monkeypatch):
    mock = AsyncMock()
    patch_chats(monkeypatch, "manager", SimpleNamespace(broadcast=mock))
    return mock


async def test_sticker_is_queued_as_a_meta_sticker(monkeypatch, broadcast):
    patch_chats(monkeypatch, "lead_exists", AsyncMock(return_value=True))
    open_service_window(monkeypatch)
    patch_chats(monkeypatch, "get_media_asset", AsyncMock(return_value={
        "id": 3, "media_url": "/api/media/images/gato.png", "content_type": "image/png",
    }))
    enqueue = AsyncMock(return_value=[{"id": 1, "outbox_status": "queued"}])
    patch_chats(monkeypatch, "enqueue_messages", enqueue)

    result = await chats.send_sticker(CHAT_ID, StickerRequest(asset_id=3), SELLER)

    assert result == {"id": 1, "outbox_status": "queued"}
    [item] = enqueue.await_args.args[1]
    assert item["message"] == {"type": "sticker", "sticker": {}}
    assert item["media"] == {"media_url": "/api/media/images/gato.png", "filename": "sticker.webp", "as_sticker": True}


async def test_sticker_rejects_assets_that_are_not_images(monkeypatch, broadcast):
    patch_chats(monkeypatch, "lead_exists", AsyncMock(return_value=True))
    open_service_window(monkeypatch)
    patch_chats(monkeypatch, "get_media_asset", AsyncMock(return_value={
        "id": 3, "media_url": "/api/media/documents/a.pdf", "content_type": "application/pdf",
    }))
    enqueue = AsyncMock()
    patch_chats(monkeypatch, "enqueue_messages", enqueue)

    with pytest.raises(HTTPException) as exc:
        await chats.send_sticker(CHAT_ID, StickerRequest(asset_id=3), SELLER)

    assert exc.value.status_code == 400
    enqueue.assert_not_awaited()


async def test_contacts_are_normalized_into_one_meta_contacts_message(monkeypatch, broadcast):
    patch_chats(monkeypatch, "lead_exists", AsyncMock(return_value=True))
    open_service_window(monkeypatch)
    patch_chats(monkeypatch, "effective_country_code", AsyncMock(return_value="51"))
    enqueue = AsyncMock(return_value=[{"id": 8, "outbox_status": "queued"}])
    patch_chats(monkeypatch, "enqueue_messages", enqueue)

    await chats.send_contacts(
        CHAT_ID,
        SendContactsRequest(contacts=[
            ContactShareItem(full_name="Ana Torres", phone_number="987 654 321"),
            ContactShareItem(full_name="Luis Pérez", phone_number="+51 912 345 678"),
        ]),
        SELLER,
    )

    [item] = enqueue.await_args.args[1]
    assert item["message"]["type"] == "contacts"
    assert [contact["phones"][0]["wa_id"] for contact in item["message"]["contacts"]] == [
        "51987654321", "51912345678",
    ]
    assert item["content"] == "Ana Torres, Luis Pérez"


async def test_interactive_is_sent_as_the_meta_object(monkeypatch, broadcast):
    patch_chats(monkeypatch, "lead_exists", AsyncMock(return_value=True))
    open_service_window(monkeypatch)
    enqueue = AsyncMock(return_value=[{"id": 9}])
    patch_chats(monkeypatch, "enqueue_messages", enqueue)
    interactive = outbound_cases()["interactive_list"]["interactive"]

    await chats.send_interactive(CHAT_ID, SendInteractiveRequest(interactive=interactive), SELLER)

    [item] = enqueue.await_args.args[1]
    assert item["message"] == {"type": "interactive", "interactive": interactive}


async def test_outbound_rejected_by_meta_rules_is_422(monkeypatch, broadcast):
    patch_chats(monkeypatch, "lead_exists", AsyncMock(return_value=True))
    open_service_window(monkeypatch)
    patch_chats(monkeypatch, "enqueue_messages", AsyncMock(side_effect=OutboundRejected("no")))

    with pytest.raises(HTTPException) as exc:
        await chats.send_interactive(
            CHAT_ID, SendInteractiveRequest(interactive={"type": "button_reply"}), SELLER,
        )

    assert exc.value.status_code == 422


async def test_official_template_to_unknown_lead_is_404_before_queueing(monkeypatch, broadcast):
    monkeypatch.setattr(chat_messaging, "list_templates", AsyncMock(return_value=[{
        "id": 4, "template_type": "official", "official_status": "APPROVED",
        "official_parameter_values": [], "content": "Hola", "official_name": "hola",
        "official_language": "es",
    }]))
    monkeypatch.setattr(chat_messaging, "lead_exists", AsyncMock(return_value=False))
    enqueue = AsyncMock()
    monkeypatch.setattr(chat_messaging, "enqueue_messages", enqueue)

    with pytest.raises(HTTPException) as exc:
        await chats.send_template(CHAT_ID, 4, SendTemplateRequest(), SELLER)

    assert exc.value.status_code == 404
    enqueue.assert_not_awaited()


def test_every_template_kind_and_error_has_a_mapping():
    assert set(chat_messaging.TEMPLATE_ITEM_BUILDERS) == {"official", "interactive", "internal"}
    assert set(TEMPLATE_ERROR_STATUS) == set(chat_messaging.ChatMessagingError.__subclasses__())


@pytest.mark.parametrize(("template", "kind"), [
    ({"template_type": "official", "interactive_type": "none"}, "official"),
    ({"template_type": "internal", "interactive_type": "button"}, "interactive"),
    ({"template_type": "internal", "interactive_type": "none"}, "internal"),
])
def test_template_kind(template, kind):
    assert chat_messaging.template_kind(template) == kind
