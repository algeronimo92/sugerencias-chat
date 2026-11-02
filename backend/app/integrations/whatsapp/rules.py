"""Plantillas interactivas del CRM con la estructura nativa de Meta.

La configuración guardada (``message_templates.interactive_config``) es el
objeto ``interactive`` de Meta sin ``type`` ni ``body``: el subtipo va en
``interactive_type`` y el cuerpo sale del texto de la plantilla, que admite
variables del lead. Al enviar se completa con esos dos y el pie por defecto
del negocio, y se valida contra la misma allowlist que cualquier salida.
"""

from typing import Any

from app.modules.platform.ports.branding import (OrganizationNotFound, get_branding)
from app.integrations.meta.contract import limit
from app.integrations.meta.outbound import validation_errors
from app.modules.platform.ports.settings_service import (get_effective)
from app.tenancy.context import get_current_tenant

# Solo para la instalación single-tenant, que no tiene marca en el plano de
# control. Con negocio activo el pie por defecto es el nombre de su marca.
FALLBACK_INTERACTIVE_FOOTER = "DermicaPro"
MAX_TEXT_LENGTH = limit("text")
# Subtipos que una plantilla del CRM puede guardar: los que no dependen de
# catálogo, Flow ni permisos de la cuenta.
TEMPLATE_INTERACTIVE_TYPES = frozenset({"button", "list"})


class InteractiveRuleError(ValueError):
    pass


async def default_interactive_footer() -> str:
    """Pie de botones y listas cuando el negocio no configuró uno: lo ve el
    cliente final en WhatsApp, así que es el nombre del negocio, nunca el de
    otro."""
    configured = (await get_effective("interactive_default_footer")).strip()
    if configured:
        return configured
    context = get_current_tenant()
    if context is None:
        return FALLBACK_INTERACTIVE_FOOTER
    try:
        name = (await get_branding(context.organization_id)).name
    except OrganizationNotFound:
        return FALLBACK_INTERACTIVE_FOOTER
    return name[: limit("footer")]


def interactive_limits_payload() -> dict:
    return {
        "body": limit("body"),
        "title": limit("header_text"),
        "footer": limit("footer"),
        "button_text": limit("button_title"),
        "button_id": limit("button_id"),
        "max_buttons": limit("max_buttons"),
        "list_button_text": limit("list_button"),
        "section_title": limit("section_title"),
        "row_title": limit("row_title"),
        "row_description": limit("row_description"),
        "row_id": limit("row_id"),
        "max_sections": limit("max_sections"),
        "max_rows": limit("max_rows"),
        "text": limit("text"),
    }


def _text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _strip_empty(config: dict) -> dict:
    cleaned = dict(config)
    header = cleaned.get("header")
    if isinstance(header, dict) and header.get("type") == "text" and not _text(header.get("text")):
        cleaned.pop("header")
    footer = cleaned.get("footer")
    if isinstance(footer, dict) and not _text(footer.get("text")):
        cleaned.pop("footer")
    return cleaned


def build_interactive(interactive_type: str, config: dict, body: str, default_footer: str) -> dict:
    """Objeto ``interactive`` listo para enviar."""
    interactive = {"type": interactive_type, **_strip_empty(config or {}), "body": {"text": body}}
    if "footer" not in interactive and default_footer:
        interactive["footer"] = {"text": default_footer}
    return interactive


def interactive_errors(interactive_type: str, config: dict, body: str, default_footer: str) -> list[str]:
    message = {"type": "interactive", "interactive": build_interactive(interactive_type, config, body, default_footer)}
    return validation_errors(message, final=True)


def normalize_interactive_config(interactive_type: str, config: dict, default_footer: str) -> dict:
    """Valida y limpia la configuración que se guarda en la plantilla.

    Se valida con un cuerpo de muestra: el real sale del texto de la
    plantilla y se vuelve a validar ya renderizado al enviar.
    """
    if interactive_type == "none":
        return {}
    if interactive_type not in TEMPLATE_INTERACTIVE_TYPES:
        raise InteractiveRuleError(f"Una plantilla no puede guardar interactive/{interactive_type}")
    cleaned = _strip_empty({key: value for key, value in (config or {}).items() if key not in {"type", "body"}})
    errors = interactive_errors(interactive_type, cleaned, "cuerpo", default_footer)
    if errors:
        raise InteractiveRuleError("; ".join(errors))
    return cleaned


async def resolve_default_footer(config: dict) -> str:
    return "" if isinstance(config.get("footer"), dict) and _text(config["footer"].get("text")) else (
        await default_interactive_footer()
    )


def interactive_choices(interactive_type: str, config: dict) -> list[str]:
    action = config.get("action") if isinstance(config.get("action"), dict) else {}
    if interactive_type == "button":
        return [
            _text((button.get("reply") or {}).get("title"))
            for button in action.get("buttons") or []
            if isinstance(button, dict)
        ]
    if interactive_type == "list":
        return [
            _text(row.get("title"))
            for section in action.get("sections") or []
            if isinstance(section, dict)
            for row in section.get("rows") or []
            if isinstance(row, dict)
        ]
    return []
