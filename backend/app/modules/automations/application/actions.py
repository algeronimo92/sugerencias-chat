"""Las acciones que ejecuta una regla o un bloque Acción de un flujo.

Un handler por tipo: agregar una acción nueva es sumar una entrada en
``ACTION_HANDLERS`` y su normalizador en ``domain.validation``, sin tocar el
despachador ni las acciones existentes.
"""

from __future__ import annotations

import dataclasses
import itertools
from datetime import timedelta

from app.modules.automations.domain.types import AutomationActionType, AutomationExecutionStatus
from app.modules.catalogs.ports.types import InteractiveType, TemplateType
from app.modules.notifications.ports.types import NotificationType

from app.modules.automations.application.deps import AutomationDeps
from app.modules.automations.domain.events import (
    AutomationMessagesQueued,
    AutomationNotificationCreated,
    AutomationTaskCreated,
)
from app.modules.automations.domain.execution import execution_actor, resolve_recipient
from app.modules.automations.domain.limits import MAX_MEDIA_CAPTION_LENGTH, MAX_WHATSAPP_TEXT_LENGTH
from app.modules.automations.domain.rules import render_variables
from app.modules.catalogs.ports.template_delivery import build_internal_template_items
from app.modules.conversations.ports.message_items import interactive_item, media_item, text_item
from app.modules.conversations.ports.message_media import mediatype_from_content_type
from app.modules.conversations.ports.service_window import SERVICE_WINDOW_CLOSED_ERROR


async def _action_create_task(action, chat, execution, rule, deps: AutomationDeps) -> dict:
    assigned_user_id = (
        action.get("assigned_user_id")
        or chat.get("vendedor_id")
        or (execution.event_payload or {}).get("assigned_user_id")
    )
    if not assigned_user_id:
        raise ValueError("No se puede crear la tarea porque el lead no tiene vendedor")
    due_at = deps.now() + timedelta(minutes=action["due_minutes"])
    remind_at = (
        due_at - timedelta(minutes=action["remind_minutes_before"])
        if action["remind_minutes_before"]
        else None
    )
    task = await deps.create_task({
        "lead_id": chat["chat_id"],
        "title": render_variables(action["title"], chat),
        "description": render_variables(action["description"], chat) if action.get("description") else None,
        "task_type": action["task_type"],
        "priority": action["priority"],
        "due_at": due_at,
        "remind_at": remind_at,
        "assigned_user_id": assigned_user_id,
    }, rule.created_by_user_id)
    await deps.publish(AutomationTaskCreated(task_id=task["id"]))
    return {"status": AutomationExecutionStatus.COMPLETED, "task_id": task["id"]}


async def _update_lead(chat, execution, deps: AutomationDeps, values: dict) -> None:
    actor_type, actor_user_id = execution_actor(execution)
    updated = await deps.update_lead(chat["chat_id"], values, actor_type, actor_user_id)
    if not updated:
        raise ValueError("Lead no encontrado")
    chat.update(updated)


async def _action_change_service(action, chat, execution, rule, deps: AutomationDeps) -> dict:
    await _update_lead(chat, execution, deps, {"servicio_interes": action["service"]})
    return {"status": AutomationExecutionStatus.COMPLETED, "service": action["service"]}


async def _action_set_conversation_state(action, chat, execution, rule, deps: AutomationDeps) -> dict:
    state = action["state"]
    should_open = state == "open"
    if bool(chat.get("conversacion_abierta")) == should_open:
        return {
            "status": AutomationExecutionStatus.SKIPPED,
            "conversation_state": state,
        }
    await _update_lead(chat, execution, deps, {"conversacion_abierta": should_open})
    return {
        "status": AutomationExecutionStatus.COMPLETED,
        "conversation_state": state,
    }


async def _action_assign_seller(action, chat, execution, rule, deps: AutomationDeps) -> dict:
    await _update_lead(chat, execution, deps, {"vendedor_id": action["user_id"]})
    return {"status": AutomationExecutionStatus.COMPLETED, "user_id": action["user_id"]}


async def _action_add_tag(action, chat, execution, rule, deps: AutomationDeps) -> dict:
    _actor_type, actor_user_id = execution_actor(execution)
    if not await deps.assign_tag(chat["chat_id"], action["tag_id"], actor_user_id):
        raise ValueError("Lead o etiqueta no encontrado")
    return {"status": AutomationExecutionStatus.COMPLETED, "tag_id": action["tag_id"]}


async def _action_remove_tag(action, chat, execution, rule, deps: AutomationDeps) -> dict:
    _actor_type, actor_user_id = execution_actor(execution)
    removed = await deps.remove_tag(chat["chat_id"], action["tag_id"], actor_user_id)
    return {
        "status": (
            AutomationExecutionStatus.COMPLETED if removed else AutomationExecutionStatus.SKIPPED
        ),
        "tag_id": action["tag_id"],
    }


async def _action_change_stage(action, chat, execution, rule, deps: AutomationDeps) -> dict:
    actor_type, actor_user_id = execution_actor(execution)
    # El cambio hecho por una automatización no dispara las de cambio de
    # etapa (ver LeadStageChanged.triggers_automations).
    updated = await deps.change_stage(
        chat["chat_id"], action["stage"], actor_type, actor_user_id,
        {"automation_rule_id": rule.id, "automation_execution_id": execution.id},
    )
    if not updated:
        raise ValueError("Lead no encontrado")
    chat.update(updated)
    return {"status": AutomationExecutionStatus.COMPLETED, "stage": action["stage"]}


async def _action_notify(action, chat, execution, rule, deps: AutomationDeps) -> dict:
    user_id = resolve_recipient(action, chat, execution.event_payload or {})
    notification = await deps.create_notification(
        user_id,
        NotificationType.AUTOMATION,
        render_variables(action["title"], chat),
        render_variables(action["body"], chat),
        chat["chat_id"],
        str(execution.id),
        {"automation_rule_id": rule.id, "automation_rule_name": rule.name},
    )
    await deps.publish(AutomationNotificationCreated(user_id=user_id, notification=notification))
    return {
        "status": AutomationExecutionStatus.COMPLETED,
        "notification_id": notification["id"],
        "user_id": user_id,
    }


async def require_service_window(chat: dict, execution, deps: AutomationDeps) -> None:
    """Frena el envío si la ventana de atención de 24 h está cerrada.

    La excepción es una ejecución que un admin autorizó a mano desde la alerta
    del fallo: ese permiso ya está dado y vale hasta que la ejecución termina,
    así un flujo con varios envíos no vuelve a pedirlo bloque por bloque. Las
    condiciones que el admin escribió sobre la ventana (`require_open_window`
    y el bloque "ventana abierta" del flujo) NO se saltean: ahí el usuario
    pidió explícitamente ramificar según la ventana.
    """
    if execution.window_override_by_user_id is not None:
        return
    window = await deps.get_customer_service_window(chat["chat_id"])
    if not window or not window["is_open"]:
        raise ValueError(SERVICE_WINDOW_CLOSED_ERROR)


async def _queued(chat: dict, deps: AutomationDeps) -> None:
    await deps.publish(AutomationMessagesQueued(chat_id=chat["chat_id"]))


async def _action_send_template(action, chat, execution, rule, deps: AutomationDeps) -> dict:
    template = await deps.load_template(action["template_id"])
    if (
        not template
        or not template["is_active"]
        or template["template_type"] != TemplateType.INTERNAL
        or template["interactive_type"] != InteractiveType.NONE
    ):
        raise ValueError("La plantilla automática dejó de ser una plantilla interna válida")
    attachments = template["attachments"]
    await require_service_window(chat, execution, deps)
    text = render_variables(template["content"], chat).strip()
    if not text and not attachments:
        raise ValueError("La plantilla no tiene contenido para enviar")
    if len(text) > MAX_WHATSAPP_TEXT_LENGTH:
        raise ValueError("El contenido renderizado de la plantilla no es válido")

    items = build_internal_template_items(text, attachments)
    # Un solo enqueue_messages para texto + todos los adjuntos: quedan
    # encolados atómicamente en una sola transacción, en vez de una llamada
    # por ítem.
    sent = await deps.enqueue_messages(chat["chat_id"], items)
    await deps.record_template_use(template["id"], rule.created_by_user_id)
    await _queued(chat, deps)
    return {
        "status": AutomationExecutionStatus.COMPLETED,
        "message_ids": [message["id"] for message in sent],
        "template_id": template["id"],
    }


async def _action_send_message(action, chat, execution, rule, deps: AutomationDeps) -> dict:
    """Envía texto libre sin pasar por una plantilla — para un mensaje de un
    solo uso dentro de un flujo puntual, cuando no vale la pena guardarlo
    como plantilla reutilizable."""
    await require_service_window(chat, execution, deps)
    text = render_variables(action["text"], chat).strip()
    if not text:
        raise ValueError("El mensaje no tiene contenido para enviar")
    if len(text) > MAX_WHATSAPP_TEXT_LENGTH:
        raise ValueError("El contenido renderizado del mensaje no es válido")
    sent = await deps.enqueue_messages(chat["chat_id"], [text_item(text)])
    await _queued(chat, deps)
    return {"status": AutomationExecutionStatus.COMPLETED, "message_ids": [sent[0]["id"]]}


async def _action_react_to_last_customer_message(action, chat, execution, rule, deps: AutomationDeps) -> dict:
    """Reacciona al mensaje entrante más reciente, aunque el vendedor haya
    enviado otros mensajes después. WhatsApp solo admite una reacción propia
    por mensaje; una ejecución posterior reemplaza la anterior.
    """
    target = await deps.fetch_latest_customer_message_target(chat["chat_id"])
    if not target:
        raise ValueError("No hay un mensaje confirmado del cliente al que reaccionar")

    emoji = action["emoji"]
    # Igual que la reacción manual: primero WhatsApp y luego el badge local,
    # para no mostrar como enviada una reacción que el cliente nunca recibió.
    # El aviso a los paneles lo da conversations al registrar la reacción.
    message = await deps.send_reaction(chat["chat_id"], target["wa_message_id"], emoji)
    return {
        "status": AutomationExecutionStatus.COMPLETED,
        "message_id": message["id"] if message else target["id"],
        "wa_message_id": target["wa_message_id"],
        "emoji": emoji,
    }


async def _media_asset(action, deps: AutomationDeps) -> dict:
    asset = await deps.load_media_asset(action["media_asset_id"])
    if not asset:
        raise ValueError("El archivo elegido ya no existe en la librería de medios")
    return asset


async def _action_send_audio(action, chat, execution, rule, deps: AutomationDeps) -> dict:
    """Manda una nota de voz (PTT) desde un archivo ya subido a la librería
    de medios — no crea una plantilla para un envío de un solo uso."""
    asset = await _media_asset(action, deps)
    if not asset["content_type"].startswith("audio/"):
        raise ValueError("El archivo elegido ya no es un audio")
    await require_service_window(chat, execution, deps)
    sent = await deps.enqueue_messages(chat["chat_id"], [
        media_item(asset["media_url"], "audio", content_type=asset["content_type"]),
    ])
    await _queued(chat, deps)
    return {"status": AutomationExecutionStatus.COMPLETED, "message_ids": [sent[0]["id"]]}


async def _action_send_attachment(action, chat, execution, rule, deps: AutomationDeps) -> dict:
    """Manda un adjunto (imagen/video/documento) de la librería de medios sin
    texto ni plantilla — mismo camino que ya usan los adjuntos de
    `_action_send_template`, apuntando a un recurso de la librería en vez de
    un adjunto de plantilla."""
    asset = await _media_asset(action, deps)
    await require_service_window(chat, execution, deps)
    mediatype = mediatype_from_content_type(asset["content_type"])
    sent = await deps.enqueue_messages(chat["chat_id"], [
        media_item(asset["media_url"], mediatype, filename=asset["filename"], content_type=asset["content_type"]),
    ])
    await _queued(chat, deps)
    return {"status": AutomationExecutionStatus.COMPLETED, "message_ids": [sent[0]["id"]]}


async def _action_send_media(action, chat, execution, rule, deps: AutomationDeps) -> dict:
    """Envía un recurso de la librería con texto opcional.

    Imagen, video y documento llevan el caption dentro del mismo mensaje.
    WhatsApp no admite caption nativo en audio: en ese caso se conserva el
    envío como nota de voz y el texto se encola justo después.
    """
    asset = await _media_asset(action, deps)
    await require_service_window(chat, execution, deps)
    caption = render_variables(action.get("caption") or "", chat).strip()
    if len(caption) > MAX_MEDIA_CAPTION_LENGTH:
        raise ValueError("El caption renderizado admite máximo 1024 caracteres")

    mediatype = mediatype_from_content_type(asset["content_type"])
    items = [media_item(
        asset["media_url"],
        mediatype,
        filename=asset["filename"],
        caption=caption or None,
        content_type=asset["content_type"],
    )]
    if mediatype == "audio" and caption:
        items.append(text_item(caption))

    sent = await deps.enqueue_messages(chat["chat_id"], items)
    await _queued(chat, deps)
    return {
        "status": AutomationExecutionStatus.COMPLETED,
        "message_ids": [message["id"] for message in sent],
    }


async def send_buttons_message(chat: dict, text: str, buttons: list[dict], deps: AutomationDeps) -> dict:
    """Manda la pregunta de un nodo ``question`` como mensaje interactivo de
    botones de Meta. ``buttons`` son ``{id, title}``; el id vuelve literal en
    ``interactive.button_reply.id`` cuando el cliente toca uno.

    Si la pregunta no cabe en un interactivo (más de tres botones, títulos
    largos) el envío se rechaza: Meta no lo aceptaría y un texto numerado no
    es lo que el flujo le prometió al cliente."""
    interactive = {
        "type": "button",
        "body": {"text": text},
        "action": {
            "buttons": [
                {"type": "reply", "reply": {"id": button["id"], "title": button["title"]}}
                for button in buttons
            ],
        },
    }
    sent = await deps.enqueue_messages(chat["chat_id"], [interactive_item(interactive, content=text)])
    await _queued(chat, deps)
    return sent[0]


ACTION_HANDLERS = {
    AutomationActionType.CREATE_TASK: _action_create_task,
    AutomationActionType.ASSIGN_SELLER: _action_assign_seller,
    AutomationActionType.CHANGE_SERVICE: _action_change_service,
    AutomationActionType.SET_CONVERSATION_STATE: _action_set_conversation_state,
    AutomationActionType.ADD_TAG: _action_add_tag,
    AutomationActionType.REMOVE_TAG: _action_remove_tag,
    AutomationActionType.CHANGE_STAGE: _action_change_stage,
    AutomationActionType.NOTIFY: _action_notify,
    AutomationActionType.SEND_TEMPLATE: _action_send_template,
    AutomationActionType.SEND_MESSAGE: _action_send_message,
    AutomationActionType.SEND_AUDIO: _action_send_audio,
    AutomationActionType.SEND_ATTACHMENT: _action_send_attachment,
    AutomationActionType.SEND_MEDIA: _action_send_media,
    AutomationActionType.REACT_TO_LAST_CUSTOMER_MESSAGE: _action_react_to_last_customer_message,
}


def with_outbox_dedupe(deps: AutomationDeps, execution_id: int, position: int) -> AutomationDeps:
    """Claves de deduplicación estables por ejecución y paso: un reintento
    tras un crash no vuelve a encolar lo que ya quedó en la outbox."""
    calls = itertools.count()

    async def enqueue_messages(chat_id: str, items: list[dict]) -> list[dict]:
        scope = f"automation:{execution_id}:{position}:{next(calls)}"
        keyed = [{**item, "dedupe_key": f"{scope}:{index}"} for index, item in enumerate(items)]
        return await deps.enqueue_messages(chat_id, keyed)

    return dataclasses.replace(deps, enqueue_messages=enqueue_messages)


async def execute_action(
    action: dict,
    chat: dict,
    execution,
    rule,
    deps: AutomationDeps,
    *,
    position: int | None = None,
) -> dict:
    handler = ACTION_HANDLERS.get(action["type"])
    if handler is None:
        raise ValueError(f"Acción no soportada: {action['type']}")
    if position is not None:
        deps = with_outbox_dedupe(deps, execution.id, position)
    result = await handler(action, chat, execution, rule, deps)
    return {"type": action["type"], **result}
