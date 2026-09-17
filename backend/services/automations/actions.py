import dataclasses
import itertools
from datetime import timedelta

from sqlalchemy import select

from db.models import (
    AutomationExecution,
    AutomationRule,
    LeadStage,
    MediaAsset,
    MessageTemplate,
    TemplateAttachment,
    WspMessage,
)
from domain_types import (
    AutomationActionType,
    AutomationExecutionStatus,
    AutomationRecipient,
    InteractiveType,
    NotificationType,
    TemplateType,
)
from services.automation_deps import DEFAULT_DEPS, AutomationDeps
from services.automations.common import (
    MAX_MEDIA_CAPTION_LENGTH,
    MAX_WHATSAPP_TEXT_LENGTH,
    _render,
)
from services.message_media import mediatype_from_content_type
from services.template_delivery import build_internal_template_items
from services.service_window import SERVICE_WINDOW_CLOSED_ERROR


def _resolve_recipient(action: dict, chat: dict, payload: dict) -> int:
    if (
        action.get("recipient") == AutomationRecipient.SPECIFIC
        and action.get("user_id")
    ):
        return int(action["user_id"])
    if chat.get("vendedor_id"):
        return int(chat["vendedor_id"])
    if payload.get("assigned_user_id"):
        return int(payload["assigned_user_id"])
    raise ValueError("El lead no tiene vendedor asignado")


async def _action_create_task(action, chat, execution, rule, deps) -> dict:
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
        "title": _render(action["title"], chat),
        "description": _render(action["description"], chat) if action.get("description") else None,
        "task_type": action["task_type"],
        "priority": action["priority"],
        "due_at": due_at,
        "remind_at": remind_at,
        "assigned_user_id": assigned_user_id,
    }, rule.created_by_user_id)
    await deps.broadcast({"type": "tasks_updated"})
    return {"status": AutomationExecutionStatus.COMPLETED, "task_id": task["id"]}


def _execution_actor(execution) -> tuple[str, int | None]:
    """Actor humano que originó una acción del motor.

    Los flujos manuales y sus flujos hijos conservan al vendedor iniciador.
    Un disparador automático no se atribuye al creador de la regla: el actor
    real es el sistema.
    """
    user_id = getattr(execution, "started_by_user_id", None)
    return ("user", user_id) if user_id is not None else ("system", None)


async def _action_change_service(action, chat, execution, rule, deps) -> dict:
    actor_type, actor_user_id = _execution_actor(execution)
    updated = await deps.update_lead(
        chat["chat_id"], {"servicio_interes": action["service"]}, actor_type, actor_user_id
    )
    if not updated:
        raise ValueError("Lead no encontrado")
    chat.update(updated)
    await deps.broadcast({"type": "chats_updated", "chat_id": chat["chat_id"], "reason": "lead_updated"})
    return {"status": AutomationExecutionStatus.COMPLETED, "service": action["service"]}


async def _action_set_conversation_state(action, chat, execution, rule, deps) -> dict:
    state = action["state"]
    should_open = state == "open"
    if bool(chat.get("conversacion_abierta")) == should_open:
        return {
            "status": AutomationExecutionStatus.SKIPPED,
            "conversation_state": state,
        }

    actor_type, actor_user_id = _execution_actor(execution)
    updated = await deps.update_lead(
        chat["chat_id"],
        {"conversacion_abierta": should_open},
        actor_type,
        actor_user_id,
    )
    if not updated:
        raise ValueError("Lead no encontrado")
    chat.update(updated)
    await deps.broadcast({
        "type": "chats_updated",
        "chat_id": chat["chat_id"],
        "reason": "conversation_opened" if should_open else "conversation_closed",
    })
    return {
        "status": AutomationExecutionStatus.COMPLETED,
        "conversation_state": state,
    }


async def _action_assign_seller(action, chat, execution, rule, deps) -> dict:
    actor_type, actor_user_id = _execution_actor(execution)
    updated = await deps.update_lead(
        chat["chat_id"], {"vendedor_id": action["user_id"]}, actor_type, actor_user_id
    )
    if not updated:
        raise ValueError("Lead no encontrado")
    chat.update(updated)
    await deps.broadcast({"type": "chats_updated", "chat_id": chat["chat_id"], "reason": "lead_updated"})
    return {"status": AutomationExecutionStatus.COMPLETED, "user_id": action["user_id"]}


async def _action_add_tag(action, chat, execution, rule, deps) -> dict:
    _actor_type, actor_user_id = _execution_actor(execution)
    if not await deps.assign_tag(chat["chat_id"], action["tag_id"], actor_user_id):
        raise ValueError("Lead o etiqueta no encontrado")
    await deps.broadcast({"type": "chats_updated", "chat_id": chat["chat_id"], "reason": "tag_changed"})
    return {"status": AutomationExecutionStatus.COMPLETED, "tag_id": action["tag_id"]}


async def _action_remove_tag(action, chat, execution, rule, deps) -> dict:
    _actor_type, actor_user_id = _execution_actor(execution)
    removed = await deps.remove_tag(chat["chat_id"], action["tag_id"], actor_user_id)
    return {
        "status": (
            AutomationExecutionStatus.COMPLETED if removed else AutomationExecutionStatus.SKIPPED
        ),
        "tag_id": action["tag_id"],
    }


async def _action_change_stage(action, chat, execution, rule, deps) -> dict:
    actor_type, actor_user_id = _execution_actor(execution)
    updated = await deps.update_lead_stage(
        chat["chat_id"], LeadStage(action["stage"]), actor_type, actor_user_id,
        {"automation_rule_id": rule.id, "automation_execution_id": execution.id},
        schedule_automations=False,
    )
    if not updated:
        raise ValueError("Lead no encontrado")
    chat.update(updated)
    await deps.broadcast({"type": "chats_updated", "chat_id": chat["chat_id"], "reason": "stage_changed"})
    return {"status": AutomationExecutionStatus.COMPLETED, "stage": action["stage"]}


async def _action_notify(action, chat, execution, rule, deps) -> dict:
    user_id = _resolve_recipient(action, chat, execution.event_payload or {})
    notification = await deps.create_notification(
        user_id,
        NotificationType.AUTOMATION,
        _render(action["title"], chat),
        _render(action["body"], chat),
        chat["chat_id"],
        str(execution.id),
        {"automation_rule_id": rule.id, "automation_rule_name": rule.name},
    )
    await deps.send_to_user(user_id, {"type": "notification_created", "notification": notification})
    return {
        "status": AutomationExecutionStatus.COMPLETED,
        "notification_id": notification["id"],
        "user_id": user_id,
    }


async def _require_service_window(
    chat: dict, execution: AutomationExecution, deps: AutomationDeps
) -> None:
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


async def _action_send_template(action, chat, execution, rule, deps) -> dict:
    async with deps.session() as session:
        template = await session.get(MessageTemplate, action["template_id"])
        attachments = (await session.execute(
            select(TemplateAttachment).where(TemplateAttachment.template_id == action["template_id"])
            .order_by(TemplateAttachment.position, TemplateAttachment.id)
        )).scalars().all()
    if (
        not template
        or not template.is_active
        or template.template_type != TemplateType.INTERNAL
        or template.interactive_type != InteractiveType.NONE
    ):
        raise ValueError("La plantilla automática dejó de ser una plantilla interna válida")
    await _require_service_window(chat, execution, deps)
    text = _render(template.content, chat).strip()
    if not text and not attachments:
        raise ValueError("La plantilla no tiene contenido para enviar")
    if len(text) > MAX_WHATSAPP_TEXT_LENGTH:
        raise ValueError("El contenido renderizado de la plantilla no es válido")

    items = build_internal_template_items(text, attachments)
    # Un solo enqueue_messages para texto + todos los adjuntos: quedan
    # encolados atómicamente en una sola transacción, en vez de una llamada
    # por ítem.
    sent = await deps.enqueue_messages(chat["chat_id"], items)
    await deps.record_template_use(template.id, rule.created_by_user_id)
    await deps.broadcast({"type": "chats_updated", "chat_id": chat["chat_id"], "reason": "outbound_message"})
    return {
        "status": AutomationExecutionStatus.COMPLETED,
        "message_ids": [message["id"] for message in sent],
        "template_id": template.id,
    }


async def _action_send_message(action, chat, execution, rule, deps) -> dict:
    """Envía texto libre sin pasar por una plantilla — para un mensaje de un
    solo uso dentro de un flujo puntual, cuando no vale la pena guardarlo
    como plantilla reutilizable."""
    await _require_service_window(chat, execution, deps)
    text = _render(action["text"], chat).strip()
    if not text:
        raise ValueError("El mensaje no tiene contenido para enviar")
    if len(text) > MAX_WHATSAPP_TEXT_LENGTH:
        raise ValueError("El contenido renderizado del mensaje no es válido")
    sent = await deps.enqueue_messages(
        chat["chat_id"], [{"content": text, "payload": {"type": "text", "text": text}}],
    )
    await deps.broadcast({"type": "chats_updated", "chat_id": chat["chat_id"], "reason": "outbound_message"})
    return {"status": AutomationExecutionStatus.COMPLETED, "message_ids": [sent[0]["id"]]}


async def _action_react_to_last_customer_message(action, chat, execution, rule, deps) -> dict:
    """Reacciona al mensaje entrante más reciente, aunque el vendedor haya
    enviado otros mensajes después. WhatsApp solo admite una reacción propia
    por mensaje; una ejecución posterior reemplaza la anterior.
    """
    target = await deps.fetch_latest_customer_message_target(chat["chat_id"])
    if not target:
        raise ValueError("No hay un mensaje confirmado del cliente al que reaccionar")

    emoji = action["emoji"]
    key = {
        "remoteJid": chat["chat_id"],
        "fromMe": False,
        "id": target["wa_message_id"],
    }
    # Igual que la reacción manual: primero WhatsApp y luego el badge local,
    # para no mostrar como enviada una reacción que el cliente nunca recibió.
    await deps.send_reaction(key, emoji)
    message = await deps.set_message_reaction(
        chat["chat_id"], target["wa_message_id"], emoji, from_me=True,
    )
    await deps.broadcast({"type": "chats_updated", "chat_id": chat["chat_id"], "reason": "reaction"})
    return {
        "status": AutomationExecutionStatus.COMPLETED,
        "message_id": message["id"] if message else target["id"],
        "wa_message_id": target["wa_message_id"],
        "emoji": emoji,
    }


async def _fetch_media_asset(action, deps: AutomationDeps) -> MediaAsset:
    async with deps.session() as session:
        asset = await session.get(MediaAsset, action["media_asset_id"])
    if not asset:
        raise ValueError("El archivo elegido ya no existe en la librería de medios")
    return asset


async def _last_outbound_media_message_id(chat_id: str, deps: AutomationDeps) -> str | None:
    """Para la condición `media_played` de una Pausa: el mensaje de imagen/
    video/audio más reciente que el vendedor le mandó a este lead antes de
    entrar a la espera — es lo que se vigila para saber cuándo lo reproduce.
    None si todavía no se le mandó nada de eso (la condición simplemente
    nunca se cumple, no es un error)."""
    async with deps.session() as session:
        return await session.scalar(
            select(WspMessage.wa_message_id).where(
                WspMessage.chat_id == chat_id,
                WspMessage.sender == "vendedor",
                WspMessage.message_type.in_(["image", "video", "audio"]),
                WspMessage.wa_message_id.isnot(None),
            ).order_by(WspMessage.sent_at.desc(), WspMessage.id.desc()).limit(1)
        )


async def _action_send_audio(action, chat, execution, rule, deps) -> dict:
    """Manda una nota de voz (PTT) desde un archivo ya subido a la librería
    de medios — no crea una plantilla para un envío de un solo uso."""
    asset = await _fetch_media_asset(action, deps)
    if not asset.content_type.startswith("audio/"):
        raise ValueError("El archivo elegido ya no es un audio")
    await _require_service_window(chat, execution, deps)
    sent = await deps.enqueue_messages(chat["chat_id"], [{
        "media_url": asset.media_url,
        "payload": {"type": "audio", "media_url": asset.media_url},
    }])
    await deps.broadcast({"type": "chats_updated", "chat_id": chat["chat_id"], "reason": "outbound_message"})
    return {"status": AutomationExecutionStatus.COMPLETED, "message_ids": [sent[0]["id"]]}


async def _action_send_attachment(action, chat, execution, rule, deps) -> dict:
    """Manda un adjunto (imagen/video/documento) de la librería de medios sin
    texto ni plantilla — mismo camino que ya usan los adjuntos de
    `_action_send_template`, apuntando a un `MediaAsset` en vez de un
    `TemplateAttachment`."""
    asset = await _fetch_media_asset(action, deps)
    await _require_service_window(chat, execution, deps)
    mediatype = mediatype_from_content_type(asset.content_type)
    sent = await deps.enqueue_messages(chat["chat_id"], [{
        "media_url": asset.media_url,
        "payload": {
            "type": "media", "media_url": asset.media_url,
            "mediatype": mediatype, "filename": asset.filename,
        },
    }])
    await deps.broadcast({"type": "chats_updated", "chat_id": chat["chat_id"], "reason": "outbound_message"})
    return {"status": AutomationExecutionStatus.COMPLETED, "message_ids": [sent[0]["id"]]}


async def _action_send_media(action, chat, execution, rule, deps) -> dict:
    """Envía un recurso de la librería con texto opcional.

    Imagen, video y documento llevan el caption dentro del mismo mensaje.
    WhatsApp no admite caption nativo en audio: en ese caso se conserva el
    envío como nota de voz y el texto se encola justo después.
    """
    asset = await _fetch_media_asset(action, deps)
    await _require_service_window(chat, execution, deps)
    caption = _render(action.get("caption") or "", chat).strip()
    if len(caption) > MAX_MEDIA_CAPTION_LENGTH:
        raise ValueError("El caption renderizado admite máximo 1024 caracteres")

    mediatype = mediatype_from_content_type(asset.content_type)
    if mediatype == "audio":
        items = [{
            "media_url": asset.media_url,
            "payload": {"type": "audio", "media_url": asset.media_url},
        }]
        if caption:
            items.append({
                "content": caption,
                "payload": {"type": "text", "text": caption},
            })
    else:
        items = [{
            "content": caption or None,
            "media_url": asset.media_url,
            "payload": {
                "type": "media",
                "media_url": asset.media_url,
                "mediatype": mediatype,
                "filename": asset.filename,
                "caption": caption or None,
            },
        }]

    sent = await deps.enqueue_messages(chat["chat_id"], items)
    await deps.broadcast({"type": "chats_updated", "chat_id": chat["chat_id"], "reason": "outbound_message"})
    return {
        "status": AutomationExecutionStatus.COMPLETED,
        "message_ids": [message["id"] for message in sent],
    }


async def _send_buttons_message(chat: dict, text: str, buttons: list[dict], deps: AutomationDeps) -> dict:
    """Manda un mensaje con botones nativos si la integración es WhatsApp
    Business; si no, cae al fallback de texto numerado (mismo que usa el
    envío manual de plantillas interactivas). Devuelve el mensaje encolado.
    Compartido por el nodo `question` (única forma de mandar botones desde
    un flujo: la acción `send_buttons` se reemplazó por ese nodo, que sí
    puede ramificar según la respuesta).

    A diferencia de la versión anterior, no decide acá mismo entre botones
    nativos y el fallback de texto numerado: encola un payload interactive y
    deja que el worker del outbox (message_outbox._send_payload) resuelva
    las capacidades en el momento real del envío — la misma lógica ya
    centralizada y probada que usa el envío manual de plantillas
    interactivas, en vez de reimplementarla acá."""
    sent = await deps.enqueue_messages(chat["chat_id"], [{
        "content": text,
        "payload": {
            "type": "interactive", "interactive_type": "buttons",
            "description": "",
            "config": {"title": text, "buttons": buttons},
        },
    }])
    return sent[0]


# Un handler por tipo de acción: agregar una acción nueva es sumar una entrada
# acá y su validación, sin tocar el despachador ni las acciones existentes.
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


def _with_outbox_dedupe(deps: AutomationDeps, execution_id: int, position: int) -> AutomationDeps:
    calls = itertools.count()

    async def enqueue_messages(chat_id: str, items: list[dict]) -> list[dict]:
        scope = f"automation:{execution_id}:{position}:{next(calls)}"
        keyed = [{**item, "dedupe_key": f"{scope}:{index}"} for index, item in enumerate(items)]
        return await deps.enqueue_messages(chat_id, keyed)

    return dataclasses.replace(deps, enqueue_messages=enqueue_messages)


async def _execute_action(
    action: dict,
    chat: dict,
    execution: AutomationExecution,
    rule: AutomationRule,
    deps: AutomationDeps = DEFAULT_DEPS,
    *,
    position: int | None = None,
) -> dict:
    handler = ACTION_HANDLERS.get(action["type"])
    if handler is None:
        raise ValueError(f"Acción no soportada: {action['type']}")
    if position is not None:
        deps = _with_outbox_dedupe(deps, execution.id, position)
    result = await handler(action, chat, execution, rule, deps)
    return {"type": action["type"], **result}
