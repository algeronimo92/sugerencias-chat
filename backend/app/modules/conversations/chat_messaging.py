from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from app.modules.automations.ports.automation_rules import (render_variables)
from app.modules.conversations.chat_queries import fetch_chat, lead_exists
from app.modules.conversations.message_outbox import enqueue_messages
from app.integrations.meta.outbound import interactive_item, location_item, media_item, sticker_item, template_item, text_item
from app.modules.catalogs.ports.template_service import (list_templates, record_template_use)
from app.modules.catalogs.ports.template_delivery import (build_internal_template_items)
from app.modules.catalogs.ports.template_validation import (render_official_body, template_parameter_identifiers)
from app.integrations.whatsapp.rules import (
    MAX_TEXT_LENGTH,
    build_interactive,
    interactive_errors,
    resolve_default_footer,
)
from app.realtime.ws_manager import manager


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
    components = []
    if values:
        variable_names = template_parameter_identifiers(template["content"])
        # Una plantilla con variables con nombre (`{{cliente}}`, a diferencia
        # de la posicional `{{1}}` que arma esta app al crear) exige mandar
        # `parameter_name` en cada parámetro -- si no, Meta responde 132012
        # ("Parameter format does not match format in the created template").
        is_named = len(variable_names) == len(values) and any(not name.isdigit() for name in variable_names)
        components.append({
            "type": "body",
            "parameters": [
                {"type": "text", "parameter_name": name, "text": value}
                if is_named else {"type": "text", "text": value}
                for name, value in zip(variable_names or values, values)
            ],
        })
    header_media = None
    if template.get("official_header_type") == "image" and template.get("official_header_media_url"):
        # El id de medio de Meta no se sube acá: subirlo ahora dejaría un id
        # que puede vencer mientras el trabajo espera en el outbox. Solo viaja
        # la referencia al archivo; el worker sube la imagen y arma el
        # componente HEADER al momento del despacho.
        header_media = {
            "media_url": template["official_header_media_url"],
            "filename": template["official_header_media_filename"],
        }
    return [template_item(
        name=template["official_name"],
        language=template["official_language"],
        components=components,
        rendered_body=render_official_body(template["content"], values) if values else (text or template["content"]),
        header_media=header_media,
        # Lo que el cliente ve de la plantilla y el cuerpo enviado no trae
        # (Meta ya la conoce por nombre e idioma).
        display={
            "header_text": template.get("official_header_text") if template.get("official_header_type") == "text" else None,
            "header_image_url": template.get("official_header_media_url") if header_media else None,
            "footer": template.get("official_footer"),
            "buttons": template.get("official_buttons") or [],
        },
    )]


async def _interactive_items(template: dict, chat_id: str, text: str, parameters: list[str]) -> list[dict]:
    chat = await fetch_chat(chat_id)
    if chat is None:
        raise LeadNotFoundError("Lead no encontrado")
    interactive_type = template["interactive_type"]
    config = render_interactive_config(template["interactive_config"], chat)
    body = text or render_variables(template["content"], chat)
    default_footer = await resolve_default_footer(config)
    errors = interactive_errors(interactive_type, config, body, default_footer)
    if errors:
        raise InvalidTemplateInputError("La plantilla no se puede enviar: " + "; ".join(errors))
    return [interactive_item(build_interactive(interactive_type, config, body, default_footer), content=body)]


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
        media = source["provider_payload"].get(mediatype) or {}
        return {
            **media_item(
                source["media_url"],
                mediatype,
                filename=media.get("filename"),
                caption=source["content"] if mediatype != "audio" else None,
                content_type=media.get("mime_type"),
            ),
            "forwarded": True,
        }

    return build


def _sticker_forward(source: dict) -> dict | None:
    if not source["media_url"]:
        return None
    return {**sticker_item(source["media_url"]), "forwarded": True}


def _location_forward(source: dict) -> dict | None:
    location = source["provider_payload"].get("location") or {}
    latitude, longitude = location.get("latitude"), location.get("longitude")
    if latitude is None or longitude is None:
        return None
    return {
        **location_item(latitude, longitude, name=location.get("name"), address=location.get("address")),
        "forwarded": True,
    }


def _contacts_forward(source: dict) -> dict | None:
    contacts = source["provider_payload"].get("contacts")
    if not isinstance(contacts, list) or not contacts:
        return None
    return {
        "content": source["content"],
        "message": {"type": "contacts", "contacts": contacts},
        "forwarded": True,
    }


def _text_forward(source: dict) -> dict | None:
    if not source["content"]:
        return None
    return {**text_item(source["content"]), "forwarded": True}


FORWARD_RULES: dict[str, ForwardRule] = {
    "image": ForwardRule(_media_forward("image")),
    "video": ForwardRule(_media_forward("video")),
    "document": ForwardRule(_media_forward("document")),
    "audio": ForwardRule(_media_forward("audio")),
    "sticker": ForwardRule(_sticker_forward),
    "location": ForwardRule(_location_forward, text_fallback=False),
    "contacts": ForwardRule(_contacts_forward),
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
        "provider_payload": message.get("provider_payload") or {},
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
