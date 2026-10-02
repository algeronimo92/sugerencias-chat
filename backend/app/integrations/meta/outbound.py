"""Salida hacia Meta: allowlist única, validación y constructores.

Todo envío (chat, plantillas, automatizaciones, reenvíos, reacciones) arma el
cuerpo con estas funciones y pasa por ``validate_message``: al encolar, para
responder 422 antes de crear el outbox, y otra vez en el worker, para que un
trabajo viejo no mande una forma que Meta no acepta.

El cuerpo es el de ``POST /{phone_number_id}/messages`` sin ``to`` ni
``messaging_product``: los agrega el dispatcher. Los adjuntos viajan en el
outbox como referencia al almacenamiento propio y reciben su ``id`` de Meta
recién al enviarse (un id subido antes puede vencer mientras el trabajo
espera).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from app.integrations.meta.contract import capability_for, contract, limit
from app.modules.platform.ports.settings_service import (get_effective_many)

ROOT_KEYS = frozenset({"type", "context", "biz_opaque_callback_data", "recipient_type"})
MEDIA_FIELDS = {
    "image": frozenset({"id", "link", "caption"}),
    "video": frozenset({"id", "link", "caption"}),
    "document": frozenset({"id", "link", "caption", "filename"}),
    "audio": frozenset({"id", "link", "voice"}),
    "sticker": frozenset({"id", "link"}),
}


class OutboundRejected(ValueError):
    """La salida no es algo que Meta acepte enviar. ``reason`` va a métricas."""

    def __init__(self, message: str, *, reason: str = "invalid"):
        super().__init__(message)
        self.reason = reason


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _require_len(errors: list[str], value: Any, maximum: int, label: str, *, required: bool = True) -> None:
    text = _text(value)
    if not text:
        if required:
            errors.append(f"{label} es obligatorio")
        return
    if len(text) > maximum:
        errors.append(f"{label} admite máximo {maximum} caracteres")


def _object(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _validate_text(message: dict, errors: list[str], final: bool) -> None:
    _require_len(errors, _object(message.get("text")).get("body"), limit("text"), "El texto")


def _validate_media(message: dict, errors: list[str], final: bool) -> None:
    root = message["type"]
    media = message.get(root)
    if not isinstance(media, dict):
        errors.append(f"Falta el objeto {root}")
        return
    unknown = set(media) - MEDIA_FIELDS[root]
    if unknown:
        errors.append(f"{root} no admite {', '.join(sorted(unknown))}")
    if final and not (media.get("id") or media.get("link")):
        errors.append(f"{root} necesita id o link")
    if "caption" in media:
        _require_len(errors, media["caption"], limit("caption"), "El epígrafe", required=False)


def _validate_location(message: dict, errors: list[str], final: bool) -> None:
    location = _object(message.get("location"))
    for field in ("latitude", "longitude"):
        if not isinstance(location.get(field), (int, float)) or isinstance(location.get(field), bool):
            errors.append(f"La ubicación necesita {field} numérica")


def _validate_contacts(message: dict, errors: list[str], final: bool) -> None:
    contacts = message.get("contacts")
    if not isinstance(contacts, list) or not 1 <= len(contacts) <= limit("max_contacts"):
        errors.append(f"Se pueden compartir entre 1 y {limit('max_contacts')} contactos")
        return
    for contact in contacts:
        if not _text(_object(_object(contact).get("name")).get("formatted_name")):
            errors.append("Cada contacto necesita name.formatted_name")


def _validate_reaction(message: dict, errors: list[str], final: bool) -> None:
    reaction = _object(message.get("reaction"))
    if not _text(reaction.get("message_id")):
        errors.append("La reacción necesita el message_id del mensaje reaccionado")
    if not isinstance(reaction.get("emoji"), str):
        errors.append("La reacción necesita emoji (vacío para quitarla)")


def _validate_template(message: dict, errors: list[str], final: bool) -> None:
    template = _object(message.get("template"))
    if not _text(template.get("name")):
        errors.append("La plantilla necesita name")
    if not _text(_object(template.get("language")).get("code")):
        errors.append("La plantilla necesita language.code")
    if "components" in template and not isinstance(template["components"], list):
        errors.append("components debe ser una lista")


def _validate_common_interactive(interactive: dict, errors: list[str], *, body_required: bool) -> None:
    _require_len(errors, _object(interactive.get("body")).get("text"), limit("body"), "El cuerpo", required=body_required)
    if "footer" in interactive:
        _require_len(errors, _object(interactive["footer"]).get("text"), limit("footer"), "El pie", required=False)
    header = interactive.get("header")
    if header is not None:
        header = _object(header)
        if header.get("type") == "text":
            _require_len(errors, header.get("text"), limit("header_text"), "El encabezado")
        elif header.get("type") not in {"image", "video", "document"}:
            errors.append("El encabezado debe ser text, image, video o document")


def _validate_button(interactive: dict, errors: list[str]) -> None:
    _validate_common_interactive(interactive, errors, body_required=True)
    buttons = _object(interactive.get("action")).get("buttons")
    if not isinstance(buttons, list) or not 1 <= len(buttons) <= limit("max_buttons"):
        errors.append(f"Los botones deben ser entre 1 y {limit('max_buttons')}")
        return
    ids: set[str] = set()
    titles: set[str] = set()
    for button in buttons:
        button = _object(button)
        reply = _object(button.get("reply"))
        if button.get("type") != "reply":
            errors.append("Un mensaje interactivo de botones solo admite botones de tipo reply")
            continue
        _require_len(errors, reply.get("id"), limit("button_id"), "El id del botón")
        _require_len(errors, reply.get("title"), limit("button_title"), "El título del botón")
        if _text(reply.get("id")) in ids or _text(reply.get("title")).lower() in titles:
            errors.append("Los botones deben tener id y título únicos")
        ids.add(_text(reply.get("id")))
        titles.add(_text(reply.get("title")).lower())


def _validate_list(interactive: dict, errors: list[str]) -> None:
    _validate_common_interactive(interactive, errors, body_required=True)
    action = _object(interactive.get("action"))
    _require_len(errors, action.get("button"), limit("list_button"), "El texto que abre la lista")
    sections = action.get("sections")
    if not isinstance(sections, list) or not 1 <= len(sections) <= limit("max_sections"):
        errors.append(f"La lista necesita entre 1 y {limit('max_sections')} secciones")
        return
    ids: set[str] = set()
    total = 0
    for section in sections:
        section = _object(section)
        if len(sections) > 1 or "title" in section:
            _require_len(errors, section.get("title"), limit("section_title"), "El título de sección")
        rows = section.get("rows")
        if not isinstance(rows, list) or not rows:
            errors.append("Cada sección necesita al menos una opción")
            continue
        for row in rows:
            row = _object(row)
            _require_len(errors, row.get("id"), limit("row_id"), "El id de la opción")
            _require_len(errors, row.get("title"), limit("row_title"), "El título de la opción")
            _require_len(errors, row.get("description"), limit("row_description"), "La descripción", required=False)
            if _text(row.get("id")) in ids:
                errors.append("Las opciones deben tener id único")
            ids.add(_text(row.get("id")))
            total += 1
    if total > limit("max_rows"):
        errors.append(f"La lista admite máximo {limit('max_rows')} opciones")


def _validate_product(interactive: dict, errors: list[str]) -> None:
    _validate_common_interactive(interactive, errors, body_required=False)
    action = _object(interactive.get("action"))
    if not _text(action.get("catalog_id")) or not _text(action.get("product_retailer_id")):
        errors.append("El producto necesita catalog_id y product_retailer_id")


def _validate_product_list(interactive: dict, errors: list[str]) -> None:
    _validate_common_interactive(interactive, errors, body_required=True)
    if _object(interactive.get("header")).get("type") != "text":
        errors.append("La lista de productos necesita un encabezado de texto")
    action = _object(interactive.get("action"))
    if not _text(action.get("catalog_id")):
        errors.append("La lista de productos necesita catalog_id")
    sections = action.get("sections")
    if not isinstance(sections, list) or not 1 <= len(sections) <= limit("max_product_sections"):
        errors.append(f"La lista de productos necesita entre 1 y {limit('max_product_sections')} secciones")
        return
    total = 0
    for section in sections:
        items = _object(section).get("product_items")
        if not isinstance(items, list) or not items:
            errors.append("Cada sección necesita productos")
            continue
        for item in items:
            if not _text(_object(item).get("product_retailer_id")):
                errors.append("Cada producto necesita product_retailer_id")
        total += len(items)
    if total > limit("max_products"):
        errors.append(f"La lista admite máximo {limit('max_products')} productos")


def _validate_named_action(name: str, *, body_required: bool = True):
    def validate(interactive: dict, errors: list[str]) -> None:
        _validate_common_interactive(interactive, errors, body_required=body_required)
        if _object(interactive.get("action")).get("name") != name:
            errors.append(f"action.name debe ser {name}")
    return validate


def _validate_flow(interactive: dict, errors: list[str]) -> None:
    _validate_named_action("flow")(interactive, errors)
    parameters = _object(_object(interactive.get("action")).get("parameters"))
    if not (_text(parameters.get("flow_id")) or _text(parameters.get("flow_name"))):
        errors.append("El Flow necesita flow_id o flow_name")
    for field in ("flow_message_version", "flow_cta"):
        if not _text(parameters.get(field)):
            errors.append(f"El Flow necesita {field}")


INTERACTIVE_VALIDATORS = {
    "button": _validate_button,
    "list": _validate_list,
    "product": _validate_product,
    "product_list": _validate_product_list,
    "catalog_message": _validate_named_action("catalog_message"),
    "flow": _validate_flow,
    "call_permission_request": _validate_named_action("call_permission_request"),
}


def _validate_interactive(message: dict, errors: list[str], final: bool) -> None:
    interactive = message.get("interactive")
    if not isinstance(interactive, dict):
        errors.append("Falta el objeto interactive")
        return
    subtype = interactive.get("type")
    if subtype not in contract().outbound.subtypes["interactive"]:
        errors.append(f"Meta no permite enviar interactive/{subtype}")
        return
    INTERACTIVE_VALIDATORS[subtype](interactive, errors)


ROOT_VALIDATORS = {
    "text": _validate_text,
    **{root: _validate_media for root in MEDIA_FIELDS},
    "location": _validate_location,
    "contacts": _validate_contacts,
    "reaction": _validate_reaction,
    "template": _validate_template,
    "interactive": _validate_interactive,
}


def validation_errors(message: Any, *, final: bool) -> list[str]:
    if not isinstance(message, dict):
        return ["El mensaje debe ser un objeto"]
    root = message.get("type")
    if root not in contract().outbound.root_types:
        return [f"Meta no permite enviar mensajes de tipo {root}"]
    errors: list[str] = []
    extra = set(message) - ROOT_KEYS - {root}
    if extra:
        errors.append(f"Campos que Meta no acepta: {', '.join(sorted(extra))}")
    if "context" in message and not _text(_object(message["context"]).get("message_id")):
        errors.append("context necesita message_id")
    ROOT_VALIDATORS[root](message, errors, final)
    return errors


def validate_message(message: Any, *, final: bool = False) -> None:
    errors = validation_errors(message, final=final)
    if errors:
        raise OutboundRejected("; ".join(errors), reason="invalid")


def message_subtype(message: dict) -> str | None:
    if message.get("type") == "interactive":
        return _object(message.get("interactive")).get("type")
    return None


CAPABILITY_SETTINGS = {
    "catalog": "meta_catalog_id",
    "flow": "meta_published_flow_ids",
    "call_permission": "meta_call_permission_enabled",
}


def published_flows(setting: str) -> list[str]:
    """Flows publicados de la cuenta: ids o nombres separados por coma."""
    return [item.strip() for item in setting.split(",") if item.strip()]


async def require_capabilities(message: dict) -> None:
    """Rechaza salidas que la cuenta conectada no tiene habilitadas.

    ``template`` se valida donde se elige la plantilla (solo APPROVED); la
    ventana de atención, donde se conoce el lead.
    """
    capability = capability_for(message["type"], message_subtype(message))
    if capability is None or capability == "approved_template":
        return
    values = await get_effective_many(tuple(CAPABILITY_SETTINGS.values()))
    interactive = _object(message.get("interactive"))
    action = _object(interactive.get("action"))
    if capability == "catalog":
        catalog_id = _text(values["meta_catalog_id"])
        if not catalog_id:
            raise OutboundRejected("La cuenta no tiene un catálogo de Meta configurado", reason="capability")
        if action.get("catalog_id") not in (None, catalog_id):
            raise OutboundRejected("El catálogo no es el configurado para la cuenta", reason="capability")
    elif capability == "flow":
        parameters = _object(action.get("parameters"))
        published = set(published_flows(values["meta_published_flow_ids"]))
        flow = _text(parameters.get("flow_id")) or _text(parameters.get("flow_name"))
        if flow not in published:
            raise OutboundRejected("El Flow no está publicado ni configurado en la cuenta", reason="capability")
    elif capability == "call_permission" and values["meta_call_permission_enabled"] != "true":
        raise OutboundRejected("La cuenta no tiene habilitadas las llamadas", reason="capability")


# --- Constructores ---------------------------------------------------------
#
# Cada uno devuelve un ítem de outbox: ``message`` es el cuerpo Meta y el
# resto son proyecciones para el CRM (``content`` para la lista y la búsqueda,
# ``media_url`` para la burbuja, ``payload`` con lo que el cuerpo no trae).


@dataclass(frozen=True)
class MediaRef:
    media_url: str
    filename: str | None = None
    as_sticker: bool = False

    def as_dict(self) -> dict:
        return {"media_url": self.media_url, "filename": self.filename, "as_sticker": self.as_sticker}


def text_item(text: str) -> dict:
    return {"content": text, "message": {"type": "text", "text": {"body": text}}}


def media_item(
    media_url: str,
    mediatype: str,
    *,
    filename: str | None = None,
    caption: str | None = None,
    content_type: str | None = None,
    album_id: str | None = None,
) -> dict:
    if mediatype not in {"image", "video", "document", "audio"}:
        raise OutboundRejected(f"Meta no permite enviar adjuntos de tipo {mediatype}")
    media: dict[str, Any] = {}
    if caption and mediatype != "audio":
        media["caption"] = caption
    if filename and mediatype == "document":
        media["filename"] = filename
    if mediatype == "audio" and (content_type or "").split(";", 1)[0].strip().lower() == "audio/ogg":
        # Meta reproduce como nota de voz solo Ogg/Opus marcado voice.
        media["voice"] = True
    return {
        "content": caption if mediatype != "audio" else None,
        "media_url": media_url,
        "message": {"type": mediatype, mediatype: media},
        "media": MediaRef(media_url, filename).as_dict(),
        "payload": {"album_id": album_id} if album_id else None,
    }


def sticker_item(media_url: str) -> dict:
    return {
        "content": None,
        "media_url": media_url,
        "message": {"type": "sticker", "sticker": {}},
        "media": MediaRef(media_url, "sticker.webp", as_sticker=True).as_dict(),
    }


def location_item(latitude: float, longitude: float, *, name: str | None = None, address: str | None = None) -> dict:
    location: dict[str, Any] = {"latitude": latitude, "longitude": longitude}
    if name:
        location["name"] = name
    if address:
        location["address"] = address
    return {"content": name or address, "message": {"type": "location", "location": location}}


def contacts_item(contacts: list[dict]) -> dict:
    """``contacts``: ``[{full_name, phone}]`` con el teléfono en dígitos E.164."""
    meta_contacts = []
    for contact in contacts:
        full_name = contact["full_name"].strip()
        digits = "".join(char for char in str(contact["phone"]) if char.isdigit())
        first_name, _separator, last_name = full_name.partition(" ")
        name: dict[str, str] = {"formatted_name": full_name, "first_name": first_name}
        if last_name:
            name["last_name"] = last_name
        meta_contacts.append({
            "name": name,
            "phones": [{"phone": f"+{digits}", "type": "CELL", "wa_id": digits}],
        })
    return {
        "content": ", ".join(contact["name"]["formatted_name"] for contact in meta_contacts),
        "message": {"type": "contacts", "contacts": meta_contacts},
    }


def reaction_message(target_wa_message_id: str, emoji: str) -> dict:
    return {"type": "reaction", "reaction": {"message_id": target_wa_message_id, "emoji": emoji}}


def template_item(
    *,
    name: str,
    language: str,
    components: list[dict],
    rendered_body: str | None,
    header_media: dict | None = None,
    display: dict | None = None,
) -> dict:
    """``display`` es lo que el CRM necesita para pintar la plantilla como la
    ve el cliente (encabezado, pie, botones): Meta ya la conoce por nombre e
    idioma y el cuerpo enviado no lo trae."""
    template: dict[str, Any] = {"name": name, "language": {"code": language}}
    if components:
        template["components"] = components
    return {
        "content": rendered_body,
        "message": {"type": "template", "template": template},
        "header_media": header_media,
        "payload": {"template": display} if display else None,
    }


def interactive_item(interactive: dict, *, content: str | None = None) -> dict:
    body_text = _object(interactive.get("body")).get("text")
    return {
        "content": content or (body_text.strip() if isinstance(body_text, str) else None),
        "message": {"type": "interactive", "interactive": interactive},
    }


def with_context(message: dict, quoted_wa_message_id: str | None) -> dict:
    if not quoted_wa_message_id or message.get("type") == "reaction":
        return message
    return {**message, "context": {"message_id": quoted_wa_message_id}}
