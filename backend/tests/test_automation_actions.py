"""Tests de la ejecución de acciones, con Evolution API y la base sustituidas.

Cubre sobre todo el envío de plantillas: es la única acción que produce un
efecto irreversible hacia afuera (un WhatsApp al cliente).
"""

import dataclasses
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from domain_types import AutomationActionType, AutomationExecutionStatus, AutomationRecipient, AutomationTrigger
from services import automation_service
from services.automation_service import _execute_action, _resolve_recipient, _run_execution
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


def media_asset(**overrides):
    defaults = {
        "id": 9, "media_url": "/media/audio.ogg", "content_type": "audio/ogg",
        "filename": "audio.ogg",
    }
    return SimpleNamespace(**{**defaults, **overrides})


def deps_with_media_asset(deps, asset):
    """Sustituye la sesión de base por una que devuelve el asset indicado
    (o None, para simular que ya no existe en la librería de medios)."""

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return False

        async def get(self, model, pk):
            return asset

    return dataclasses.replace(deps, session_factory=lambda: FakeSession)


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


class _MediaValidationSession:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def execute(self, stmt):
        return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [9]))


class TestSendMediaValidation:
    async def test_rule_accepts_and_preserves_caption(self, monkeypatch):
        monkeypatch.setattr(
            automation_service,
            "get_sessionmaker",
            lambda: lambda: _MediaValidationSession(),
        )

        values = await automation_service.validate_automation_rule({
            "name": "Video de bienvenida",
            "trigger_type": AutomationTrigger.MANUAL,
            "actions": [{
                "type": AutomationActionType.SEND_MEDIA,
                "media_asset_id": 9,
                "caption": "  Hola {{nombre}}  ",
            }],
        })

        assert values["actions"] == [{
            "type": AutomationActionType.SEND_MEDIA,
            "media_asset_id": 9,
            "caption": "Hola {{nombre}}",
        }]

    async def test_rule_rejects_caption_over_limit(self):
        with pytest.raises(ValueError, match="caption admite máximo 1024"):
            await automation_service.validate_automation_rule({
                "name": "Video largo",
                "trigger_type": AutomationTrigger.MANUAL,
                "actions": [{
                    "type": AutomationActionType.SEND_MEDIA,
                    "media_asset_id": 9,
                    "caption": "x" * 1025,
                }],
            })


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

    async def test_change_service_sets_the_new_value(self, deps, recorder):
        chat = make_chat(servicio_interes="Botox")
        action = {"type": AutomationActionType.CHANGE_SERVICE, "service": "Hollywood Peel"}
        await _execute_action(action, chat, make_execution(), make_rule(), deps)
        assert recorder.lead_updates == [("51999@s.whatsapp.net", {"servicio_interes": "Hollywood Peel"})]
        assert chat["servicio_interes"] == "Hollywood Peel"

    async def test_change_service_with_none_clears_it(self, deps, recorder):
        action = {"type": AutomationActionType.CHANGE_SERVICE, "service": None}
        await _execute_action(action, make_chat(), make_execution(), make_rule(), deps)
        assert recorder.lead_updates == [("51999@s.whatsapp.net", {"servicio_interes": None})]

    async def test_change_service_fails_when_lead_is_gone(self, deps):
        async def not_found(chat_id, values, actor_type="system", actor_user_id=None):
            return None

        action = {"type": AutomationActionType.CHANGE_SERVICE, "service": "Botox"}
        with pytest.raises(ValueError, match="Lead no encontrado"):
            await _execute_action(
                action, make_chat(), make_execution(), make_rule(),
                dataclasses.replace(deps, update_lead=not_found),
            )


class TestConversationState:
    async def test_rule_accepts_and_preserves_state(self):
        values = await automation_service.validate_automation_rule({
            "name": "Cerrar al terminar",
            "trigger_type": AutomationTrigger.MANUAL,
            "actions": [{
                "type": AutomationActionType.SET_CONVERSATION_STATE,
                "state": "closed",
            }],
        })

        assert values["actions"] == [{
            "type": AutomationActionType.SET_CONVERSATION_STATE,
            "state": "closed",
        }]

    async def test_rule_rejects_unknown_state(self):
        with pytest.raises(ValueError, match="estado de conversación inválido"):
            await automation_service.validate_automation_rule({
                "name": "Estado inválido",
                "trigger_type": AutomationTrigger.MANUAL,
                "actions": [{
                    "type": AutomationActionType.SET_CONVERSATION_STATE,
                    "state": "toggle",
                }],
            })

    async def test_opens_a_closed_conversation(self, deps, recorder):
        chat = make_chat(conversacion_abierta=False)
        action = {
            "type": AutomationActionType.SET_CONVERSATION_STATE,
            "state": "open",
        }

        result = await _execute_action(
            action, chat, make_execution(), make_rule(), deps,
        )

        assert result["status"] == AutomationExecutionStatus.COMPLETED
        assert recorder.lead_updates == [(
            "51999@s.whatsapp.net", {"conversacion_abierta": True},
        )]
        assert chat["conversacion_abierta"] is True
        assert recorder.broadcasts[-1]["reason"] == "conversation_opened"

    async def test_closes_an_open_conversation(self, deps, recorder):
        chat = make_chat(conversacion_abierta=True)
        action = {
            "type": AutomationActionType.SET_CONVERSATION_STATE,
            "state": "closed",
        }

        result = await _execute_action(
            action, chat, make_execution(), make_rule(), deps,
        )

        assert result["status"] == AutomationExecutionStatus.COMPLETED
        assert recorder.lead_updates == [(
            "51999@s.whatsapp.net", {"conversacion_abierta": False},
        )]
        assert chat["conversacion_abierta"] is False
        assert recorder.broadcasts[-1]["reason"] == "conversation_closed"

    async def test_same_state_is_idempotent(self, deps, recorder):
        action = {
            "type": AutomationActionType.SET_CONVERSATION_STATE,
            "state": "open",
        }

        result = await _execute_action(
            action,
            make_chat(conversacion_abierta=True),
            make_execution(),
            make_rule(),
            deps,
        )

        assert result["status"] == AutomationExecutionStatus.SKIPPED
        assert recorder.lead_updates == []
        assert recorder.broadcasts == []


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
    async def test_sends_rendered_text_and_records_message(self, deps, outbox):
        action = {"type": AutomationActionType.SEND_TEMPLATE, "template_id": 5}
        result = await _execute_action(
            action, make_chat(), make_execution(), make_rule(), deps_with_template(deps, template()),
        )
        assert outbox.enqueued == [(
            "51999@s.whatsapp.net",
            [{"content": "Hola Ana", "payload": {"type": "text", "text": "Hola Ana"}}],
        )]
        assert result["message_ids"] == [1]

    async def test_refuses_to_send_when_window_is_closed(self, deps, outbox):
        async def closed_window(chat_id):
            return {"is_open": False, "seconds_remaining": 0}

        action = {"type": AutomationActionType.SEND_TEMPLATE, "template_id": 5}
        closed = dataclasses.replace(deps_with_template(deps, template()), get_customer_service_window=closed_window)
        with pytest.raises(ValueError, match="ventana de 24 horas"):
            await _execute_action(action, make_chat(), make_execution(), make_rule(), closed)
        assert outbox.enqueued == []

    async def test_sends_text_as_caption_of_first_compatible_attachment(self, deps, outbox):
        action = {"type": AutomationActionType.SEND_TEMPLATE, "template_id": 5}
        with_media = deps_with_template(
            deps, template(),
            [attachment(filename="foto.jpg"), attachment(id=2, filename="guia.pdf", content_type="application/pdf")],
        )
        await _execute_action(action, make_chat(), make_execution(), make_rule(), with_media)

        # El texto se integra al primer adjunto y todo queda en una única
        # llamada a enqueue_messages.
        assert len(outbox.enqueued) == 1
        chat_id, items = outbox.enqueued[0]
        assert chat_id == "51999@s.whatsapp.net"
        assert len(items) == 2
        assert items[0]["content"] == "Hola Ana"
        assert items[0]["payload"] == {
            "type": "media", "media_url": "/media/foto.jpg", "mediatype": "image",
            "filename": "foto.jpg", "caption": "Hola Ana",
        }
        assert items[1]["payload"] == {
            "type": "media", "media_url": "/media/foto.jpg", "mediatype": "document",
            "filename": "guia.pdf", "caption": None,
        }

    async def test_audio_only_template_keeps_text_as_separate_message(self, deps, outbox):
        action = {"type": AutomationActionType.SEND_TEMPLATE, "template_id": 5}
        audio = attachment(content_type="audio/ogg", filename="indicacion.ogg")
        await _execute_action(
            action, make_chat(), make_execution(), make_rule(),
            deps_with_template(deps, template(), [audio]),
        )

        _, items = outbox.enqueued[0]
        assert items[0] == {"content": "Hola Ana", "payload": {"type": "text", "text": "Hola Ana"}}
        assert items[1]["payload"]["mediatype"] == "audio"
        assert items[1]["payload"]["caption"] is None

    async def test_attachment_only_template_needs_no_text(self, deps, outbox):
        action = {"type": AutomationActionType.SEND_TEMPLATE, "template_id": 5}
        only_media = deps_with_template(deps, template(content="  "), [attachment()])
        await _execute_action(action, make_chat(), make_execution(), make_rule(), only_media)
        _, items = outbox.enqueued[0]
        assert len(items) == 1
        assert items[0]["payload"]["type"] == "media"

    @pytest.mark.parametrize("bad", [
        {"is_active": False},
        {"template_type": "official"},
        {"interactive_type": "buttons"},
    ])
    async def test_rejects_templates_that_are_no_longer_automatable(self, deps, outbox, bad):
        action = {"type": AutomationActionType.SEND_TEMPLATE, "template_id": 5}
        invalid = deps_with_template(deps, template(**bad))
        with pytest.raises(ValueError, match="plantilla interna válida"):
            await _execute_action(action, make_chat(), make_execution(), make_rule(), invalid)
        assert outbox.enqueued == []

    async def test_rejects_text_over_whatsapp_limit(self, deps):
        action = {"type": AutomationActionType.SEND_TEMPLATE, "template_id": 5}
        huge = deps_with_template(deps, template(content="x" * 5000))
        with pytest.raises(ValueError, match="no es válido"):
            await _execute_action(action, make_chat(), make_execution(), make_rule(), huge)


class TestSendMessage:
    """Enviar texto libre sin plantilla — mismo circuito que SendTemplate
    pero sin buscar plantilla ni adjuntos."""

    async def test_sends_rendered_text_and_records_message(self, deps, outbox):
        action = {"type": AutomationActionType.SEND_MESSAGE, "text": "Hola {{nombre}}, ¿seguimos?"}
        result = await _execute_action(action, make_chat(), make_execution(), make_rule(), deps)
        assert outbox.enqueued == [(
            "51999@s.whatsapp.net",
            [{"content": "Hola Ana, ¿seguimos?", "payload": {"type": "text", "text": "Hola Ana, ¿seguimos?"}}],
        )]
        assert result["message_ids"] == [1]

    async def test_refuses_to_send_when_window_is_closed(self, deps, outbox):
        async def closed_window(chat_id):
            return {"is_open": False, "seconds_remaining": 0}

        action = {"type": AutomationActionType.SEND_MESSAGE, "text": "Hola"}
        closed = dataclasses.replace(deps, get_customer_service_window=closed_window)
        with pytest.raises(ValueError, match="ventana de 24 horas"):
            await _execute_action(action, make_chat(), make_execution(), make_rule(), closed)
        assert outbox.enqueued == []

    async def test_rejects_text_that_renders_empty(self, deps):
        action = {"type": AutomationActionType.SEND_MESSAGE, "text": "   "}
        with pytest.raises(ValueError, match="no tiene contenido"):
            await _execute_action(action, make_chat(), make_execution(), make_rule(), deps)

    async def test_rejects_text_over_whatsapp_limit(self, deps):
        action = {"type": AutomationActionType.SEND_MESSAGE, "text": "x" * 5000}
        with pytest.raises(ValueError, match="no es válido"):
            await _execute_action(action, make_chat(), make_execution(), make_rule(), deps)


class TestReactToLastCustomerMessage:
    async def test_reacts_to_latest_customer_message_and_updates_chat(self, deps, recorder, whatsapp):
        action = {
            "type": AutomationActionType.REACT_TO_LAST_CUSTOMER_MESSAGE,
            "emoji": "❤️",
        }

        result = await _execute_action(action, make_chat(), make_execution(), make_rule(), deps)

        assert whatsapp.reactions == [({
            "remoteJid": "51999@s.whatsapp.net",
            "fromMe": False,
            "id": "CLIENT-WA-42",
        }, "❤️")]
        assert recorder.reactions == [(
            "51999@s.whatsapp.net", "CLIENT-WA-42", "❤️", True,
        )]
        assert result["message_id"] == 42
        assert result["emoji"] == "❤️"
        assert recorder.broadcasts[-1]["reason"] == "reaction"

    async def test_fails_clearly_when_customer_has_no_confirmed_message(self, deps, whatsapp):
        async def no_target(chat_id):
            return None

        action = {
            "type": AutomationActionType.REACT_TO_LAST_CUSTOMER_MESSAGE,
            "emoji": "👍",
        }
        without_target = dataclasses.replace(
            deps, fetch_latest_customer_message_target=no_target,
        )

        with pytest.raises(ValueError, match="No hay un mensaje confirmado del cliente"):
            await _execute_action(action, make_chat(), make_execution(), make_rule(), without_target)
        assert whatsapp.reactions == []

    async def test_does_not_persist_if_whatsapp_rejects_reaction(self, deps, recorder, whatsapp):
        whatsapp.fail_with = RuntimeError("Evolution no disponible")
        action = {
            "type": AutomationActionType.REACT_TO_LAST_CUSTOMER_MESSAGE,
            "emoji": "😂",
        }

        with pytest.raises(RuntimeError, match="Evolution no disponible"):
            await _execute_action(action, make_chat(), make_execution(), make_rule(), deps)
        assert recorder.reactions == []


class TestSendAudio:
    async def test_sends_audio_from_media_library(self, deps, outbox):
        action = {"type": AutomationActionType.SEND_AUDIO, "media_asset_id": 9}
        result = await _execute_action(
            action, make_chat(), make_execution(), make_rule(),
            deps_with_media_asset(deps, media_asset()),
        )
        chat_id, items = outbox.enqueued[0]
        assert chat_id == "51999@s.whatsapp.net"
        assert items == [{"media_url": "/media/audio.ogg", "payload": {"type": "audio", "media_url": "/media/audio.ogg"}}]
        assert result["message_ids"] == [1]

    async def test_rejects_when_asset_is_not_audio(self, deps):
        action = {"type": AutomationActionType.SEND_AUDIO, "media_asset_id": 9}
        not_audio = deps_with_media_asset(deps, media_asset(content_type="image/png"))
        with pytest.raises(ValueError, match="ya no es un audio"):
            await _execute_action(action, make_chat(), make_execution(), make_rule(), not_audio)

    async def test_refuses_to_send_when_window_is_closed(self, deps):
        async def closed_window(chat_id):
            return {"is_open": False, "seconds_remaining": 0}

        action = {"type": AutomationActionType.SEND_AUDIO, "media_asset_id": 9}
        closed = dataclasses.replace(deps_with_media_asset(deps, media_asset()), get_customer_service_window=closed_window)
        with pytest.raises(ValueError, match="ventana de 24 horas"):
            await _execute_action(action, make_chat(), make_execution(), make_rule(), closed)

    async def test_fails_when_asset_no_longer_exists(self, deps):
        action = {"type": AutomationActionType.SEND_AUDIO, "media_asset_id": 9}
        gone = deps_with_media_asset(deps, None)
        with pytest.raises(ValueError, match="ya no existe"):
            await _execute_action(action, make_chat(), make_execution(), make_rule(), gone)


class TestSendAttachment:
    async def test_sends_image_attachment_without_text(self, deps, outbox):
        action = {"type": AutomationActionType.SEND_ATTACHMENT, "media_asset_id": 9}
        asset = media_asset(content_type="image/jpeg", filename="foto.jpg")
        await _execute_action(action, make_chat(), make_execution(), make_rule(), deps_with_media_asset(deps, asset))
        _, items = outbox.enqueued[0]
        assert "content" not in items[0]
        assert items[0]["payload"]["mediatype"] == "image"
        assert items[0]["payload"]["filename"] == "foto.jpg"

    async def test_sends_document_with_filename_in_payload(self, deps, outbox):
        action = {"type": AutomationActionType.SEND_ATTACHMENT, "media_asset_id": 9}
        asset = media_asset(content_type="application/pdf", filename="guia.pdf")
        await _execute_action(action, make_chat(), make_execution(), make_rule(), deps_with_media_asset(deps, asset))
        _, items = outbox.enqueued[0]
        assert items[0]["payload"]["mediatype"] == "document"
        assert items[0]["payload"]["filename"] == "guia.pdf"


class TestSendMedia:
    async def test_sends_video_with_rendered_native_caption(self, deps, outbox):
        action = {
            "type": AutomationActionType.SEND_MEDIA,
            "media_asset_id": 9,
            "caption": "Hola {{nombre}}, mira este video",
        }
        asset = media_asset(
            media_url="/media/demo.mp4",
            content_type="video/mp4",
            filename="demo.mp4",
        )

        result = await _execute_action(
            action, make_chat(name="Ana"), make_execution(), make_rule(),
            deps_with_media_asset(deps, asset),
        )

        _, items = outbox.enqueued[0]
        assert items == [{
            "content": "Hola Ana, mira este video",
            "media_url": "/media/demo.mp4",
            "payload": {
                "type": "media",
                "media_url": "/media/demo.mp4",
                "mediatype": "video",
                "filename": "demo.mp4",
                "caption": "Hola Ana, mira este video",
            },
        }]
        assert result["message_ids"] == [1]

    async def test_sends_audio_then_companion_text(self, deps, outbox):
        action = {
            "type": AutomationActionType.SEND_MEDIA,
            "media_asset_id": 9,
            "caption": "Escucha esta indicación",
        }

        result = await _execute_action(
            action, make_chat(), make_execution(), make_rule(),
            deps_with_media_asset(deps, media_asset()),
        )

        _, items = outbox.enqueued[0]
        assert items == [
            {
                "media_url": "/media/audio.ogg",
                "payload": {"type": "audio", "media_url": "/media/audio.ogg"},
            },
            {
                "content": "Escucha esta indicación",
                "payload": {"type": "text", "text": "Escucha esta indicación"},
            },
        ]
        assert result["message_ids"] == [1, 2]

    async def test_allows_media_without_caption(self, deps, outbox):
        action = {
            "type": AutomationActionType.SEND_MEDIA,
            "media_asset_id": 9,
            "caption": "",
        }
        asset = media_asset(content_type="image/jpeg", filename="foto.jpg")

        await _execute_action(
            action, make_chat(), make_execution(), make_rule(),
            deps_with_media_asset(deps, asset),
        )

        _, items = outbox.enqueued[0]
        assert items[0]["content"] is None
        assert items[0]["payload"]["caption"] is None


class TestDispatch:
    async def test_unknown_action_type_is_rejected(self, deps):
        with pytest.raises(ValueError, match="no soportada"):
            await _execute_action({"type": "inventada"}, make_chat(), make_execution(), make_rule(), deps)

    async def test_result_always_carries_the_action_type(self, deps):
        action = {"type": AutomationActionType.ADD_TAG, "tag_id": 1}
        result = await _execute_action(action, make_chat(), make_execution(), make_rule(), deps)
        assert result["type"] == AutomationActionType.ADD_TAG


class TestResumeDoesNotRepeatEnqueuedActions:
    async def test_run_execution_only_executes_the_remaining_action(self, deps, outbox):
        """Un reintento tras un crash no debe reenviar un WhatsApp que ya se
        encoló — el chequeo de qué acciones ya corrieron es puramente
        posicional (len(action_results) vs. cantidad de acciones); nunca
        dependió del wa_message_id real, que con el outbox ni siquiera se
        conoce en este punto (el mensaje queda "pending" hasta que el worker
        lo procesa)."""
        execution = SimpleNamespace(
            id=1, rule_id=1, lead_id="51999@s.whatsapp.net",
            action_results=[{
                "position": 1, "type": AutomationActionType.SEND_MESSAGE,
                "status": AutomationExecutionStatus.COMPLETED, "message_ids": [1],
            }],
            event_payload={}, flow_state={},
        )
        rule = make_rule(
            builder_mode="simple", max_executions_per_hour=None,
            actions=[
                {"type": AutomationActionType.SEND_MESSAGE, "text": "Primero"},
                {"type": AutomationActionType.SEND_MESSAGE, "text": "Segundo"},
            ],
        )

        class FakeSession:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *exc):
                return False

            async def get(self, model, pk):
                name = getattr(model, "__name__", "")
                return execution if name == "AutomationExecution" else rule

            async def execute(self, stmt):
                return SimpleNamespace(rowcount=1)

            async def commit(self):
                pass

        test_deps = dataclasses.replace(
            deps,
            session_factory=lambda: FakeSession,
            fetch_chat=AsyncMock(return_value=make_chat()),
        )

        await _run_execution(1, test_deps)

        assert len(outbox.enqueued) == 1
        _, items = outbox.enqueued[0]
        assert items[0]["content"] == "Segundo"
