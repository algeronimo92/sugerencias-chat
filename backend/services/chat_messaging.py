from collections.abc import Awaitable, Callable
from dataclasses import dataclass

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


@dataclass(frozen=True)
class ForwardRule:
    build: Callable[[dict], dict | None]
    text_fallback: bool = True


def _media_forward(mediatype: str) -> Callable[[dict], dict | None]:
    def build(source: dict) -> dict | None:
        if not source["media_url"]:
            return None
        return {
            "content": source["content"],
            "media_url": source["media_url"],
            "payload": {
                "type": "media",
                "media_url": source["media_url"],
                "mediatype": mediatype,
                "filename": source["payload"].get("filename"),
                "caption": source["content"],
            },
            "forwarded": True,
        }

    return build


def _stored_media_forward(kind: str) -> Callable[[dict], dict | None]:
    def build(source: dict) -> dict | None:
        if not source["media_url"]:
            return None
        return {
            "content": None,
            "media_url": source["media_url"],
            "payload": {"type": kind, "media_url": source["media_url"]},
            "forwarded": True,
        }

    return build


def _location_forward(source: dict) -> dict | None:
    latitude = source["payload"].get("latitude")
    longitude = source["payload"].get("longitude")
    if latitude is None or longitude is None:
        return None
    return {
        "content": None,
        "payload": {"type": "location", "latitude": latitude, "longitude": longitude},
        "forwarded": True,
    }


def _text_forward(source: dict) -> dict | None:
    if not source["content"]:
        return None
    return {
        "content": source["content"],
        "payload": {"type": "text", "text": source["content"]},
        "forwarded": True,
    }


FORWARD_RULES: dict[str, ForwardRule] = {
    "image": ForwardRule(_media_forward("image")),
    "video": ForwardRule(_media_forward("video")),
    # Un video-nota sale como video normal: WhatsApp no deja crear uno nuevo
    # desde la API, y mandarlo como video conserva el contenido.
    "ptv": ForwardRule(_media_forward("video")),
    "document": ForwardRule(_media_forward("document")),
    "audio": ForwardRule(_stored_media_forward("audio")),
    "sticker": ForwardRule(_stored_media_forward("sticker")),
    "location": ForwardRule(_location_forward, text_fallback=False),
}


def forward_item(message: dict) -> dict | None:
    """Convierte un mensaje guardado en un ítem de outbox para otro chat.

    Reenviar es volver a enviar el contenido, no delegar en WhatsApp: el
    archivo ya está en nuestro almacenamiento y el texto en la base, así que
    el destino recibe un mensaje nuevo con el mismo contenido (como el
    "Reenviar" de WhatsApp, que tampoco reenvía el mensaje original).

    Lo que no se puede reconstruir del otro lado —plantillas, interactivos, y
    también un adjunto cuyo archivo ya no está— viaja como texto plano
    mientras quede algo que decir. La ubicación es la excepción: sin
    coordenadas no hay nada que mandar, y su contenido es un marcador interno.

    Devuelve None cuando no queda nada reenviable.
    """
    source = {
        "kind": message["message_type"],
        "content": (message["content"] or "").strip() or None,
        "media_url": message["media_url"],
        "payload": message["payload"] or {},
    }
    rule = FORWARD_RULES.get(source["kind"])
    if rule is None:
        return _text_forward(source)
    item = rule.build(source)
    if item is not None:
        return item
    return _text_forward(source) if rule.text_fallback else None


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
