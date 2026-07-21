"""Tests de la ejecución de acciones, con Evolution API y la base sustituidas.

Cubre sobre todo el envío de plantillas: es la única acción que produce un
efecto irreversible hacia afuera (un WhatsApp al cliente).
"""

import dataclasses
from datetime import timedelta
from types import SimpleNamespace

import pytest

from domain_types import AutomationActionType, AutomationExecutionStatus, AutomationRecipient
from services.automation_service import _execute_action, _resolve_recipient
from tests.conftest import make_chat, make_execution, make_rule


def template(**overrides):
    defaults = {
        "id": 5, "content": "Hola {{nombre}}", "is_active": True,
        "template_type": "internal", "interactive_type": "none",
    }
    return SimpleNamespace(**{**defaults, **overrides})


def attachment(**overrides):
    defaults = {
        "id": 1, "media_url": "/media/foto.jpg", "content_type": "image/jpeg",
        "filename": "foto.jpg", "position": 0,
    }
    return SimpleNamespace(**{**defaults, **overrides})


def deps_with_template(deps, tpl, attachments=()):
    """Sustituye la sesión de base por una que devuelve la plantilla indicada."""

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, model, pk):
            return tpl

        async def execute(self, stmt):
            return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: list(attachments)))

    return dataclasses.replace(deps, session_factory=lambda: FakeSession)


class TestCreateTask:
    async def test_creates_task_with_rendered_title_and_due_date(self, deps, recorder, frozen_now):
        action = {
            "type": AutomationActionType.CREATE_TASK,
            "title": "Seguir a {{nombre}}", "description": None,
            "task_type": "seguimiento", "priority": "normal",
            "due_minutes": 60, "remind_minutes_before": 15,
            "assigned_user_id": None,
        }
        result = await _execute_action(action, make_chat(), make_execution(), make_rule(), deps)

        assert result["status"] == AutomationExecutionStatus.COMPLETED
        assert recorder.tasks[0]["title"] == "Seguir a Ana"
        assert recorder.tasks[0]["due_at"] == frozen_now + timedelta(minutes=60)
        assert recorder.tasks[0]["remind_at"] == frozen_now + timedelta(minutes=45)

    async def test_falls_back_to_lead_seller_when_no_assignee(self, deps, recorder):
        action = {
            "type": AutomationActionType.CREATE_TASK, "title": "X", "description": None,
            "task_type": "seguimiento", "priority": "normal",
            "due_minutes": 30, "remind_minutes_before": 0, "assigned_user_id": None,
        }
        await _execute_action(action, make_chat(vendedor_id=7), make_execution(), make_rule(), deps)
        assert recorder.tasks[0]["assigned_user_id"] == 7

    async def test_fails_when_nobody_can_be_assigned(self, deps):
        action = {
            "type": AutomationActionType.CREATE_TASK, "title": "X", "description": None,
            "task_type": "seguimiento", "priority": "normal",
            "due_minutes": 30, "remind_minutes_before": 0, "assigned_user_id": None,
        }
        with pytest.raises(ValueError, match="no tiene vendedor"):
            await _execute_action(action, make_chat(vendedor_id=None), make_execution(), make_rule(), deps)


class TestTagsAndStage:
    async def test_add_tag(self, deps, recorder):
        action = {"type": AutomationActionType.ADD_TAG, "tag_id": 3}
        result = await _execute_action(action, make_chat(), make_execution(), make_rule(), deps)
        assert result["status"] == AutomationExecutionStatus.COMPLETED
        assert recorder.tags_added == [("51999@s.whatsapp.net", 3)]

    async def test_remove_tag_that_was_not_assigned_is_skipped_not_failed(self, deps):
        async def remove_nothing(chat_id, tag_id, user_id):
            return False

        action = {"type": AutomationActionType.REMOVE_TAG, "tag_id": 3}
        result = await _execute_action(
            action, make_chat(), make_execution(), make_rule(),
            dataclasses.replace(deps, remove_tag=remove_nothing),
        )
        assert result["status"] == AutomationExecutionStatus.SKIPPED

    async def test_change_stage_updates_local_chat_for_later_actions(self, deps, recorder):
        chat = make_chat(stage="nuevo")
        action = {"type": AutomationActionType.CHANGE_STAGE, "stage": "oferta_presentada"}
        await _execute_action(action, chat, make_execution(), make_rule(), deps)
        assert recorder.stage_changes == [("51999@s.whatsapp.net", "oferta_presentada")]
        # El chat en memoria se actualiza para que una acción posterior de la
        # misma ejecución vea la etapa nueva.
        assert chat["stage"] == "oferta_presentada"


class TestNotify:
    async def test_notifies_lead_seller_by_default(self, deps, recorder):
        action = {
            "type": AutomationActionType.NOTIFY, "recipient": AutomationRecipient.SELLER,
            "user_id": None, "title": "Revisa {{nombre}}", "body": "Pendiente",
        }
        await _execute_action(action, make_chat(vendedor_id=7), make_execution(), make_rule(), deps)
        assert recorder.notifications[0]["user_id"] == 7
        assert recorder.notifications[0]["title"] == "Revisa Ana"

    def test_specific_recipient_wins_over_lead_seller(self):
        action = {"recipient": AutomationRecipient.SPECIFIC, "user_id": 99}
        assert _resolve_recipient(action, make_chat(vendedor_id=7), {}) == 99

    def test_falls_back_to_payload_assignee(self):
        action = {"recipient": AutomationRecipient.SELLER}
        assert _resolve_recipient(action, make_chat(vendedor_id=None), {"assigned_user_id": 4}) == 4

    def test_raises_when_no_recipient_can_be_resolved(self):
        with pytest.raises(ValueError, match="no tiene vendedor"):
            _resolve_recipient({"recipient": AutomationRecipient.SELLER}, make_chat(vendedor_id=None), {})


class TestSendTemplate:
    async def test_sends_rendered_text_and_records_message(self, deps, recorder, whatsapp):
        action = {"type": AutomationActionType.SEND_TEMPLATE, "template_id": 5}
        result = await _execute_action(
            action, make_chat(), make_execution(), make_rule(), deps_with_template(deps, template()),
        )
        assert whatsapp.texts == [("51999@s.whatsapp.net", "Hola Ana")]
        assert recorder.messages[0]["sender"] == "vendedor"
        assert recorder.messages[0]["wa_message_id"] == "WA1"
        assert result["message_ids"] == [1]

    async def test_refuses_to_send_when_window_is_closed(self, deps, whatsapp):
        async def closed_window(chat_id):
            return {"is_open": False, "seconds_remaining": 0}

        action = {"type": AutomationActionType.SEND_TEMPLATE, "template_id": 5}
        closed = dataclasses.replace(deps_with_template(deps, template()), get_customer_service_window=closed_window)
        with pytest.raises(ValueError, match="ventana de 24 horas"):
            await _execute_action(action, make_chat(), make_execution(), make_rule(), closed)
        assert whatsapp.texts == []

    async def test_sends_text_and_each_attachment(self, deps, whatsapp, recorder):
        action = {"type": AutomationActionType.SEND_TEMPLATE, "template_id": 5}
        with_media = deps_with_template(
            deps, template(),
            [attachment(filename="foto.jpg"), attachment(id=2, filename="guia.pdf", content_type="application/pdf")],
        )
        await _execute_action(action, make_chat(), make_execution(), make_rule(), with_media)

        assert len(whatsapp.texts) == 1
        assert whatsapp.media == [
            ("51999@s.whatsapp.net", "image", "foto.jpg"),
            ("51999@s.whatsapp.net", "document", "guia.pdf"),
        ]
        # El documento guarda el nombre real dentro del tag; la imagen no.
        assert recorder.messages[1]["content"] == "<image></image>"
        assert recorder.messages[2]["content"] == "<other>guia.pdf</other>"

    async def test_attachment_only_template_needs_no_text(self, deps, whatsapp):
        action = {"type": AutomationActionType.SEND_TEMPLATE, "template_id": 5}
        only_media = deps_with_template(deps, template(content="  "), [attachment()])
        await _execute_action(action, make_chat(), make_execution(), make_rule(), only_media)
        assert whatsapp.texts == []
        assert len(whatsapp.media) == 1

    async def test_missing_attachment_file_aborts_with_clear_message(self, deps):
        def missing(media_url):
            raise FileNotFoundError(media_url)

        action = {"type": AutomationActionType.SEND_TEMPLATE, "template_id": 5}
        broken = dataclasses.replace(
            deps_with_template(deps, template(), [attachment()]), read_media_base64=missing,
        )
        with pytest.raises(ValueError, match="No se encontró el adjunto foto.jpg"):
            await _execute_action(action, make_chat(), make_execution(), make_rule(), broken)

    @pytest.mark.parametrize("bad", [
        {"is_active": False},
        {"template_type": "official"},
        {"interactive_type": "buttons"},
    ])
    async def test_rejects_templates_that_are_no_longer_automatable(self, deps, whatsapp, bad):
        action = {"type": AutomationActionType.SEND_TEMPLATE, "template_id": 5}
        invalid = deps_with_template(deps, template(**bad))
        with pytest.raises(ValueError, match="plantilla interna válida"):
            await _execute_action(action, make_chat(), make_execution(), make_rule(), invalid)
        assert whatsapp.texts == []

    async def test_rejects_text_over_whatsapp_limit(self, deps):
        action = {"type": AutomationActionType.SEND_TEMPLATE, "template_id": 5}
        huge = deps_with_template(deps, template(content="x" * 5000))
        with pytest.raises(ValueError, match="no es válido"):
            await _execute_action(action, make_chat(), make_execution(), make_rule(), huge)


class TestDispatch:
    async def test_unknown_action_type_is_rejected(self, deps):
        with pytest.raises(ValueError, match="no soportada"):
            await _execute_action({"type": "inventada"}, make_chat(), make_execution(), make_rule(), deps)

    async def test_result_always_carries_the_action_type(self, deps):
        action = {"type": AutomationActionType.ADD_TAG, "tag_id": 1}
        result = await _execute_action(action, make_chat(), make_execution(), make_rule(), deps)
        assert result["type"] == AutomationActionType.ADD_TAG
