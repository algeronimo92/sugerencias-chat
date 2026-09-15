from collections.abc import Awaitable, Callable

from services.automation_rules import render_variables
from services.db_service import fetch_chat, lead_exists
from services.message_outbox import enqueue_messages
from services.productivity_service import list_templates, record_template_use
from services.template_delivery import build_internal_template_items
from services.whatsapp_rules import (
    MAX_TEXT_LENGTH,
    interactive_choices_summary,
    rendered_interactive_errors,
    resolve_interactive_footer,
)
from services.ws_manager import manager


class ChatMessagingError(Exception):
    pass


class TemplateNotFoundError(ChatMessagingError):
    pass


class LeadNotFoundError(ChatMessagingError):
    pass


class TemplateNotSendableError(ChatMessagingError):
    pass


class InvalidTemplateInputError(ChatMessagingError):
    pass


def render_interactive_config(value, chat: dict):
    if isinstance(value, str):
        return render_variables(value, chat)
    if isinstance(value, list):
        return [render_interactive_config(item, chat) for item in value]
    if isinstance(value, dict):
        return {key: render_interactive_config(item, chat) for key, item in value.items()}
    return value


async def _official_items(template: dict, chat_id: str, text: str, parameters: list[str]) -> list[dict]:
    if template["official_status"] != "APPROVED":
        raise TemplateNotSendableError("Solo se pueden enviar plantillas oficiales con estado APPROVED")
    values = [value.strip() for value in parameters]
    if len(values) != len(template["official_parameter_values"]) or any(not value for value in values):
        raise InvalidTemplateInputError("Los parámetros no coinciden con las variables de la plantilla oficial")
    components = (
        [{"type": "body", "parameters": [{"type": "text", "text": value} for value in values]}]
        if values else []
    )
    return [{
        "content": text or template["content"],
        "payload": {
            "type": "official_template",
            "name": template["official_name"],
            "language": template["official_language"],
            "components": components,
        },
    }]


async def _interactive_items(template: dict, chat_id: str, text: str, parameters: list[str]) -> list[dict]:
    chat = await fetch_chat(chat_id)
    if chat is None:
        raise LeadNotFoundError("Lead no encontrado")
    interactive_type = template["interactive_type"]
    config = render_interactive_config(template["interactive_config"], chat)
    description = text or render_variables(template["content"], chat)
    errors = rendered_interactive_errors(
        interactive_type, description, config, await resolve_interactive_footer(interactive_type, config),
    )
    if errors:
        raise InvalidTemplateInputError("La plantilla no se puede enviar: " + "; ".join(errors))
    choices = interactive_choices_summary(interactive_type, config)
    return [{
        "content": f"{config['title']}\n{description}\nOpciones: {choices}",
        "payload": {
            "type": "interactive",
            "interactive_type": interactive_type,
            "description": description,
            "config": config,
        },
    }]


async def _internal_items(template: dict, chat_id: str, text: str, parameters: list[str]) -> list[dict]:
    if not text and not template["attachments"]:
        raise InvalidTemplateInputError("La plantilla no tiene contenido para enviar")
    if len(text) > MAX_TEXT_LENGTH:
        raise InvalidTemplateInputError(f"El texto de la plantilla supera el máximo de {MAX_TEXT_LENGTH} caracteres")
    return build_internal_template_items(text, template["attachments"])


TemplateItemsBuilder = Callable[[dict, str, str, list[str]], Awaitable[list[dict]]]

TEMPLATE_ITEM_BUILDERS: dict[str, TemplateItemsBuilder] = {
    "official": _official_items,
    "interactive": _interactive_items,
    "internal": _internal_items,
}


def template_kind(template: dict) -> str:
    if template["template_type"] == "official":
        return "official"
    return "interactive" if template["interactive_type"] != "none" else "internal"


async def send_template(
    chat_id: str, template_id: int, text: str | None, parameters: list[str], user_id: int,
) -> list[dict]:
    template = next((item for item in await list_templates(user_id) if item["id"] == template_id), None)
    if template is None:
        raise TemplateNotFoundError("Plantilla no encontrada")
    if not await lead_exists(chat_id):
        raise LeadNotFoundError("Lead no encontrado")
    build_items = TEMPLATE_ITEM_BUILDERS[template_kind(template)]
    items = await build_items(template, chat_id, (text or "").strip(), parameters)
    sent = await enqueue_messages(chat_id, items, actor_user_id=user_id)
    await record_template_use(template_id, user_id)
    await manager.broadcast({"type": "chats_updated", "chat_id": chat_id, "reason": "outbound_queued"})
    return sent
