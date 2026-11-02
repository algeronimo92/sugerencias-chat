"""Ediciones y borrados hechos en WhatsApp (``edit`` / ``revoke``).

No son mensajes nuevos: cambian uno que ya está en el hilo. Si el original lo
mandó el CRM, el eco del celular lo nombra con otro ``wamid`` (con el BSUID del
contacto en vez de su número), así que se reconoce por la clave del mensaje.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from app.integrations.meta.wamid import message_key
from app.integrations.meta_webhook import metrics, processor
from app.modules.conversations.domain.events import ProviderMessageChanged

# El mismo mensaje enviado por el CRM: como lo devolvió la API (con el número)
# y como lo nombra el eco del celular (con el BSUID). Ids reales de Meta.
SENT_BY_PHONE = "wamid.HBgLNTE5NjI3MDI3MjEVAgARGBRDRTQwNTM5ODA5NDg3MDA0RjczRQA="
SAME_BY_BSUID = "wamid.HBgTUEUuMTEwNzcxODEwODk2ODU4OBUUABEYFENFNDA1Mzk4MDk0ODcwMDRGNzNFAA=="
OTHER_MESSAGE = "wamid.HBgLNTE5NTk0Nzc3NDYVAgARGBRDRTVDNTAxRjk2MjgyMzUxMDlBMgA="


def test_the_key_is_the_same_whether_the_wamid_names_the_phone_or_the_bsuid():
    assert message_key(SENT_BY_PHONE) == message_key(SAME_BY_BSUID) == "11:CE40539809487004F73E"
    assert message_key(OTHER_MESSAGE) != message_key(SENT_BY_PHONE)


@pytest.mark.parametrize("wamid", [None, "", "WA-text", "wamid.", "wamid.no-es-base64!", "wamid.aG9sYQ=="])
def test_an_id_without_the_meta_structure_has_no_key(wamid):
    assert message_key(wamid) is None


@pytest.fixture
def chat(in_memory_conversations, monkeypatch):
    """Un chat con un mensaje del CRM y otro del celular, y las consultas que
    el procesador hace a la base resueltas contra los fakes."""
    world = in_memory_conversations

    async def insert(wa_message_id, content):
        message, _ = await world.messages.insert_provider_message(
            chat_id="lead-1", wa_message_id=wa_message_id, content=content,
        )
        return message

    async def wa_ids(chat_id, limit=2000):
        return [
            (m["id"], m["wa_message_id"]) for m in world.messages.stored.values() if m["chat_id"] == chat_id
        ]

    async def chat_for(wa_message_id):
        message = world.messages.stored.get(wa_message_id)
        return message["chat_id"] if message else None

    monkeypatch.setattr(processor, "chat_wa_message_ids", wa_ids)
    monkeypatch.setattr(processor, "chat_id_for_wa_message", chat_for)
    return SimpleNamespace(world=world, insert=insert)


def _edit(original: str, body: str, timestamp: str = "1793641217") -> dict:
    return {
        "from": "51903479212", "to": "51962702721", "id": "wamid.EDIT", "timestamp": timestamp,
        "type": "edit",
        "edit": {"original_message_id": original, "message": {"type": "text", "text": {"body": body}}},
    }


def _revoke(original: str) -> dict:
    return {
        "from": "51903479212", "to": "51962702721", "id": "wamid.REVOKE", "timestamp": "1793641456",
        "type": "revoke", "revoke": {"original_message_id": original},
    }


@pytest.mark.asyncio
async def test_an_edit_rewrites_the_original_found_by_its_key(chat):
    original = await chat.insert(SENT_BY_PHONE, "¿Hoy o mañana?")
    await chat.insert(OTHER_MESSAGE, "Otro mensaje")

    await processor._edit_or_revoke(_edit(SAME_BY_BSUID, "¿Mañana o el miércoles?"), "lead-1")

    assert original["content"] == "¿Mañana o el miércoles?"
    assert original["edited_at"] == datetime.fromtimestamp(1793641217, tz=timezone.utc)
    assert len(chat.world.messages.stored) == 2
    assert [type(e) for e in chat.world.published] == [ProviderMessageChanged]
    assert chat.world.published[0].change == "edited"


@pytest.mark.asyncio
async def test_an_older_edit_arriving_late_does_not_undo_a_newer_one(chat):
    original = await chat.insert(SENT_BY_PHONE, "v1")
    await processor._edit_or_revoke(_edit(SENT_BY_PHONE, "v3", timestamp="1793641300"), "lead-1")
    await processor._edit_or_revoke(_edit(SENT_BY_PHONE, "v2", timestamp="1793641200"), "lead-1")
    assert original["content"] == "v3"


@pytest.mark.asyncio
async def test_a_revoke_marks_the_original_as_deleted_once(chat):
    original = await chat.insert(SENT_BY_PHONE, "Precio equivocado")

    await processor._edit_or_revoke(_revoke(SAME_BY_BSUID), "lead-1")
    await processor._edit_or_revoke(_revoke(SAME_BY_BSUID), "lead-1")

    assert original["deleted_at"] == datetime.fromtimestamp(1793641456, tz=timezone.utc)
    assert [e.change for e in chat.world.published] == ["deleted"]


@pytest.mark.asyncio
async def test_a_change_to_a_message_the_crm_never_had_is_counted_and_dropped(chat):
    counter = metrics.unmatched_messages.labels(kind="revoke")
    before = counter._value.get()

    await processor._edit_or_revoke(_revoke(SAME_BY_BSUID), "lead-1")

    assert counter._value.get() == before + 1
    assert chat.world.messages.stored == {}
    assert chat.world.published == []


@pytest.mark.asyncio
async def test_edits_and_revokes_never_become_messages_of_their_own(monkeypatch):
    resolved = SimpleNamespace(chat_id="lead-1")
    monkeypatch.setattr(processor, "resolve_whatsapp_identity", AsyncMock(return_value=resolved))
    store = AsyncMock()
    change = AsyncMock()
    monkeypatch.setattr(processor, "_store_message", store)
    monkeypatch.setattr(processor, "_edit_or_revoke", change)

    for message in (_edit(SENT_BY_PHONE, "nuevo"), _revoke(SENT_BY_PHONE)):
        await processor._conversation_message(message, object(), inbound=False, webhook_event_id="evt")

    store.assert_not_awaited()
    assert change.await_count == 2
