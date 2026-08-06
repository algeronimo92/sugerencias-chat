from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from routers import chats
from models.schemas import EditMessageRequest
from services.evolution_service import EvolutionApiError

CHAT_ID = "51999@s.whatsapp.net"


def _target(**overrides) -> dict:
    """Mensaje del vendedor, de texto, recién enviado: el caso que WhatsApp
    permite editar y eliminar. Cada test rompe una condición a la vez."""
    return {
        "id": 7,
        "sender": "vendedor",
        "content": "hola",
        "wa_message_id": "WA-7",
        "message_type": "text",
        "sent_at": datetime.now(timezone.utc) - timedelta(minutes=1),
        "deleted_at": None,
        **overrides,
    }


def _patch(monkeypatch, *, target, edit=None, delete=None, update=None, mark=None):
    monkeypatch.setattr(chats, "fetch_reply_target", AsyncMock(return_value=target))
    edit = edit or AsyncMock(return_value={})
    delete = delete or AsyncMock(return_value={})
    update = update or AsyncMock(return_value={"id": 7, "content": "corregido"})
    mark = mark or AsyncMock(return_value={"id": 7, "deleted_at": "2026-08-06T12:00:00.000Z"})
    monkeypatch.setattr(chats, "edit_whatsapp_message", edit)
    monkeypatch.setattr(chats, "delete_whatsapp_message", delete)
    monkeypatch.setattr(chats, "update_message_content", update)
    monkeypatch.setattr(chats, "mark_message_deleted", mark)
    monkeypatch.setattr(chats.manager, "broadcast", AsyncMock())
    return edit, delete, update, mark


class TestEdit:
    @pytest.mark.asyncio
    async def test_sends_to_whatsapp_and_persists_trimmed_text(self, monkeypatch):
        edit, _, update, _ = _patch(monkeypatch, target=_target())

        result = await chats.edit_message(CHAT_ID, 7, EditMessageRequest(text="  corregido  "))

        edit.assert_awaited_once_with(CHAT_ID, "WA-7", "corregido")
        update.assert_awaited_once_with(CHAT_ID, "WA-7", "corregido")
        assert result["content"] == "corregido"

    @pytest.mark.asyncio
    async def test_missing_message_returns_404(self, monkeypatch):
        _patch(monkeypatch, target=None)
        with pytest.raises(HTTPException) as exc:
            await chats.edit_message(CHAT_ID, 7, EditMessageRequest(text="corregido"))
        assert exc.value.status_code == 404

    @pytest.mark.asyncio
    async def test_customer_message_returns_409(self, monkeypatch):
        _patch(monkeypatch, target=_target(sender="cliente"))
        with pytest.raises(HTTPException) as exc:
            await chats.edit_message(CHAT_ID, 7, EditMessageRequest(text="corregido"))
        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_unconfirmed_message_returns_409(self, monkeypatch):
        _patch(monkeypatch, target=_target(wa_message_id=None))
        with pytest.raises(HTTPException) as exc:
            await chats.edit_message(CHAT_ID, 7, EditMessageRequest(text="corregido"))
        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_attachment_returns_409(self, monkeypatch):
        # WhatsApp solo edita texto: un epígrafe de imagen no se puede reescribir.
        _patch(monkeypatch, target=_target(message_type="image"))
        with pytest.raises(HTTPException) as exc:
            await chats.edit_message(CHAT_ID, 7, EditMessageRequest(text="corregido"))
        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_outside_15_minute_window_returns_409(self, monkeypatch):
        edit, _, update, _ = _patch(
            monkeypatch,
            target=_target(sent_at=datetime.now(timezone.utc) - timedelta(minutes=16)),
        )
        with pytest.raises(HTTPException) as exc:
            await chats.edit_message(CHAT_ID, 7, EditMessageRequest(text="corregido"))
        assert exc.value.status_code == 409
        # Ni siquiera se intenta: WhatsApp lo descartaría en silencio.
        edit.assert_not_awaited()
        update.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_does_not_persist_when_evolution_fails(self, monkeypatch):
        _, _, update, _ = _patch(
            monkeypatch,
            target=_target(),
            edit=AsyncMock(side_effect=EvolutionApiError("boom")),
        )
        with pytest.raises(HTTPException) as exc:
            await chats.edit_message(CHAT_ID, 7, EditMessageRequest(text="corregido"))
        assert exc.value.status_code == 502
        update.assert_not_awaited()


class TestDelete:
    @pytest.mark.asyncio
    async def test_deletes_in_whatsapp_and_marks_row(self, monkeypatch):
        _, delete, _, mark = _patch(monkeypatch, target=_target())

        result = await chats.delete_message(CHAT_ID, 7)

        delete.assert_awaited_once_with(CHAT_ID, "WA-7")
        mark.assert_awaited_once_with(CHAT_ID, "WA-7")
        assert result["deleted_at"] is not None

    @pytest.mark.asyncio
    async def test_old_message_is_still_deletable(self, monkeypatch):
        # La ventana de 15 minutos es solo de la edición: eliminar no la tiene.
        _, delete, _, _ = _patch(
            monkeypatch,
            target=_target(sent_at=datetime.now(timezone.utc) - timedelta(hours=5)),
        )
        await chats.delete_message(CHAT_ID, 7)
        delete.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_attachment_is_deletable(self, monkeypatch):
        _, delete, _, _ = _patch(monkeypatch, target=_target(message_type="image"))
        await chats.delete_message(CHAT_ID, 7)
        delete.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_already_deleted_returns_409(self, monkeypatch):
        _, delete, _, _ = _patch(
            monkeypatch,
            target=_target(deleted_at=datetime.now(timezone.utc)),
        )
        with pytest.raises(HTTPException) as exc:
            await chats.delete_message(CHAT_ID, 7)
        assert exc.value.status_code == 409
        delete.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_customer_message_returns_409(self, monkeypatch):
        # "Eliminar para todos" ajeno no existe en un chat 1:1.
        _patch(monkeypatch, target=_target(sender="cliente"))
        with pytest.raises(HTTPException) as exc:
            await chats.delete_message(CHAT_ID, 7)
        assert exc.value.status_code == 409

    @pytest.mark.asyncio
    async def test_does_not_mark_when_evolution_fails(self, monkeypatch):
        _, _, _, mark = _patch(
            monkeypatch,
            target=_target(),
            delete=AsyncMock(side_effect=EvolutionApiError("boom")),
        )
        with pytest.raises(HTTPException) as exc:
            await chats.delete_message(CHAT_ID, 7)
        assert exc.value.status_code == 502
        # Si no se borró en WhatsApp, en el CRM sigue estando.
        mark.assert_not_awaited()
