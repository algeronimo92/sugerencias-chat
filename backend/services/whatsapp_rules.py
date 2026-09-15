import re
from collections.abc import Callable
from dataclasses import asdict, dataclass

from services.settings_service import get_effective

FALLBACK_INTERACTIVE_FOOTER = "DermicaPro"
MAX_TEXT_LENGTH = 4096


@dataclass(frozen=True)
class InteractiveLimits:
    body: int = 1024
    title: int = 60
    footer: int = 60
    button_text: int = 20
    button_id: int = 256
    max_buttons: int = 3
    list_button_text: int = 20
    section_title: int = 24
    row_title: int = 24
    row_description: int = 72
    row_id: int = 200
    max_sections: int = 10
    max_rows: int = 10


LIMITS = InteractiveLimits()


class InteractiveRuleError(ValueError):
    pass


async def default_interactive_footer() -> str:
    return (await get_effective("interactive_default_footer")).strip() or FALLBACK_INTERACTIVE_FOOTER


def interactive_limits_payload() -> dict:
    return {**asdict(LIMITS), "text": MAX_TEXT_LENGTH}


def _text(value) -> str:
    return str(value or "").strip()


def _require_common(title: str, footer: str) -> None:
    if len(title) > LIMITS.title:
        raise InteractiveRuleError(f"El título interactivo admite máximo {LIMITS.title} caracteres")
    if len(footer) > LIMITS.footer:
        raise InteractiveRuleError(f"El pie de mensaje admite máximo {LIMITS.footer} caracteres")


def _normalize_buttons(config: dict, default_footer: str) -> dict:
    title = _text(config.get("title"))
    footer = _text(config.get("footer")) or default_footer
    buttons = config.get("buttons") if isinstance(config.get("buttons"), list) else []
    if not title or not 1 <= len(buttons) <= LIMITS.max_buttons:
        raise InteractiveRuleError(f"Los botones requieren título y entre 1 y {LIMITS.max_buttons} opciones")
    _require_common(title, footer)
    normalized = []
    seen_texts: set[str] = set()
    seen_ids: set[str] = set()
    for index, item in enumerate(buttons):
        if not isinstance(item, dict) or item.get("type") != "reply":
            raise InteractiveRuleError(
                "Los botones de una plantilla interna solo admiten respuesta rápida; "
                "para un botón de URL, llamada o copiar código creá una plantilla oficial"
            )
        display_text = _text(item.get("displayText"))
        if not display_text or display_text.lower() in seen_texts:
            raise InteractiveRuleError("Cada botón necesita un texto único")
        if len(display_text) > LIMITS.button_text:
            raise InteractiveRuleError(f"El texto de cada botón admite máximo {LIMITS.button_text} caracteres")
        seen_texts.add(display_text.lower())
        value = _text(item.get("id") or f"reply_{index + 1}")
        if len(value) > LIMITS.button_id:
            raise InteractiveRuleError(f"El ID de respuesta admite máximo {LIMITS.button_id} caracteres")
        if value in seen_ids:
            raise InteractiveRuleError("Los IDs de respuesta deben ser únicos")
        seen_ids.add(value)
        normalized.append({"type": "reply", "displayText": display_text, "id": value})
    return {"title": title, "footer": footer, "buttons": normalized}


def _normalize_list(config: dict, default_footer: str) -> dict:
    title = _text(config.get("title"))
    footer_text = _text(config.get("footerText")) or default_footer
    button_text = _text(config.get("buttonText"))
    sections = config.get("sections") if isinstance(config.get("sections"), list) else []
    if not title or not button_text or not sections:
        raise InteractiveRuleError("La lista requiere título, texto del botón y al menos una sección")
    _require_common(title, footer_text)
    if len(button_text) > LIMITS.list_button_text:
        raise InteractiveRuleError(f"El texto que abre la lista admite máximo {LIMITS.list_button_text} caracteres")
    if len(sections) > LIMITS.max_sections:
        raise InteractiveRuleError(f"Una lista admite como máximo {LIMITS.max_sections} secciones")
    normalized_sections = []
    seen_section_titles: set[str] = set()
    seen_row_ids: set[str] = set()
    total_rows = 0
    for section in sections:
        section_title = _text(section.get("title")) if isinstance(section, dict) else ""
        rows = section.get("rows") if isinstance(section, dict) and isinstance(section.get("rows"), list) else []
        if not section_title or not rows or section_title.lower() in seen_section_titles:
            raise InteractiveRuleError("Cada sección necesita un título único y al menos una opción")
        if len(section_title) > LIMITS.section_title:
            raise InteractiveRuleError(f"El título de sección admite máximo {LIMITS.section_title} caracteres")
        seen_section_titles.add(section_title.lower())
        normalized_rows = []
        for row in rows:
            row_title = _text(row.get("title")) if isinstance(row, dict) else ""
            row_id = _text(row.get("rowId")) if isinstance(row, dict) else ""
            description = _text(row.get("description")) if isinstance(row, dict) else ""
            if not row_title or not description or not row_id or row_id in seen_row_ids:
                raise InteractiveRuleError("Cada opción necesita título, descripción e ID único")
            if len(row_title) > LIMITS.row_title:
                raise InteractiveRuleError(f"El título de cada opción admite máximo {LIMITS.row_title} caracteres")
            if len(description) > LIMITS.row_description:
                raise InteractiveRuleError(
                    f"La descripción de cada opción admite máximo {LIMITS.row_description} caracteres"
                )
            if len(row_id) > LIMITS.row_id:
                raise InteractiveRuleError(f"El ID de cada opción admite máximo {LIMITS.row_id} caracteres")
            seen_row_ids.add(row_id)
            normalized_rows.append({"title": row_title, "description": description, "rowId": row_id})
            total_rows += 1
        normalized_sections.append({"title": section_title, "rows": normalized_rows})
    if total_rows > LIMITS.max_rows:
        raise InteractiveRuleError(f"Una lista admite como máximo {LIMITS.max_rows} opciones")
    return {
        "title": title, "footerText": footer_text, "buttonText": button_text,
        "sections": normalized_sections,
    }


def _rendered_button_errors(config: dict) -> list[str]:
    errors = []
    for index, button in enumerate(config.get("buttons", []), start=1):
        label = _text(button.get("displayText"))
        if not label or len(label) > LIMITS.button_text:
            errors.append(f"el texto del botón {index} debe tener entre 1 y {LIMITS.button_text} caracteres")
        button_type = button.get("type")
        if button_type == "url":
            url = _text(button.get("url"))
            if not re.fullmatch(r"https://[^\s]{1,2040}", url, flags=re.IGNORECASE):
                errors.append(f"la URL del botón {index} no es válida")
        elif button_type == "call":
            phone = re.sub(r"[\s()\-]", "", str(button.get("phoneNumber") or ""))
            if not re.fullmatch(r"\+?[1-9]\d{7,14}", phone):
                errors.append(f"el teléfono del botón {index} no es válido")
    return errors


def _rendered_list_errors(config: dict) -> list[str]:
    errors = []
    button_text = _text(config.get("buttonText"))
    if not button_text or len(button_text) > LIMITS.list_button_text:
        errors.append(f"el texto que abre la lista debe tener entre 1 y {LIMITS.list_button_text} caracteres")
    for section_index, section in enumerate(config.get("sections", []), start=1):
        section_title = _text(section.get("title"))
        if not section_title or len(section_title) > LIMITS.section_title:
            errors.append(
                f"el título de la sección {section_index} debe tener entre 1 y {LIMITS.section_title} caracteres"
            )
        for row_index, row in enumerate(section.get("rows", []), start=1):
            prefix = f"la opción {row_index} de la sección {section_index}"
            if not _text(row.get("title")) or len(_text(row.get("title"))) > LIMITS.row_title:
                errors.append(f"{prefix} necesita un título de máximo {LIMITS.row_title} caracteres")
            description = _text(row.get("description"))
            if not description or len(description) > LIMITS.row_description:
                errors.append(f"{prefix} necesita una descripción de máximo {LIMITS.row_description} caracteres")
            row_id = _text(row.get("rowId"))
            if not row_id or len(row_id) > LIMITS.row_id:
                errors.append(f"{prefix} necesita un ID de máximo {LIMITS.row_id} caracteres")
    return errors


@dataclass(frozen=True)
class InteractiveRule:
    footer_field: str
    normalize: Callable[[dict, str], dict]
    rendered_errors: Callable[[dict], list[str]]
    choices: Callable[[dict], list[str]]


INTERACTIVE_RULES: dict[str, InteractiveRule] = {
    "buttons": InteractiveRule(
        footer_field="footer",
        normalize=_normalize_buttons,
        rendered_errors=_rendered_button_errors,
        choices=lambda config: [button["displayText"] for button in config["buttons"]],
    ),
    "list": InteractiveRule(
        footer_field="footerText",
        normalize=_normalize_list,
        rendered_errors=_rendered_list_errors,
        choices=lambda config: [row["title"] for section in config["sections"] for row in section["rows"]],
    ),
}


def _rule(interactive_type: str) -> InteractiveRule:
    rule = INTERACTIVE_RULES.get(interactive_type)
    if rule is None:
        raise InteractiveRuleError(f"Tipo interactivo no soportado: {interactive_type}")
    return rule


def normalize_interactive_config(interactive_type: str, config: dict, default_footer: str) -> dict:
    if interactive_type == "none":
        return {}
    return _rule(interactive_type).normalize(config or {}, default_footer)


def interactive_footer(interactive_type: str, config: dict, default_footer: str) -> str:
    return _text(config.get(_rule(interactive_type).footer_field)) or default_footer


async def resolve_interactive_footer(interactive_type: str, config: dict) -> str:
    return interactive_footer(interactive_type, config, "") or await default_interactive_footer()


def rendered_interactive_errors(
    interactive_type: str, description: str, config: dict, default_footer: str,
) -> list[str]:
    errors: list[str] = []
    title = _text(config.get("title"))
    footer = interactive_footer(interactive_type, config, default_footer)
    if not description.strip():
        errors.append("la descripción quedó vacía")
    elif len(description) > LIMITS.body:
        errors.append(f"la descripción supera {LIMITS.body} caracteres")
    if not title:
        errors.append("el título quedó vacío")
    elif len(title) > LIMITS.title:
        errors.append(f"el título supera {LIMITS.title} caracteres")
    if len(footer) > LIMITS.footer:
        errors.append(f"el pie supera {LIMITS.footer} caracteres")
    return errors + _rule(interactive_type).rendered_errors(config)


def interactive_choices_summary(interactive_type: str, config: dict) -> str:
    return " · ".join(_rule(interactive_type).choices(config))


def buttons_are_reply_only(buttons: list[dict]) -> bool:
    return all(button.get("type") == "reply" for button in buttons)


BUTTON_FALLBACK_LINES: dict[str, Callable[[int, str, dict], str]] = {
    "reply": lambda index, label, _button: f"{index}. {label}",
    "url": lambda _index, label, button: f"• {label}: {button.get('url', '')}",
    "call": lambda _index, label, button: f"• {label}: {button.get('phoneNumber', '')}",
}


def buttons_text_fallback(title: str, description: str, footer: str, buttons: list[dict]) -> str:
    lines = [f"*{title}*", description, ""]
    for index, button in enumerate(buttons, start=1):
        label = _text(button.get("displayText"))
        line = BUTTON_FALLBACK_LINES.get(
            button.get("type"),
            lambda _index, text, item: f"• {text}: {item.get('copyCode', '')}",
        )
        lines.append(line(index, label, button))
    if buttons_are_reply_only(buttons):
        lines.extend(["", "Responde con el número de la opción que deseas."])
    if footer:
        lines.extend(["", footer])
    return "\n".join(lines)
