"""Validación y normalización de plantillas, antes de tocar la base o Meta.

Las reglas de una plantilla interna y las de una oficial son distintas: la
interna admite nuestras variables por nombre y opcionalmente botones/listas
interactivos; la oficial la aprueba Meta, sus variables son posicionales y su
encabezado, pie y botones siguen el formato de la Graph API.

Contraparte de `services/automations/rule_validation.py` para plantillas: acá
no se conoce HTTP, se lanzan errores de dominio y el router los traduce.

También vive acá el resuelto de variables de una plantilla oficial
(`template_parameter_identifiers`/`render_official_body`): son puramente de
formato -sin red-, así que quedan junto al resto del conocimiento sobre cómo
Meta arma una plantilla, en vez de en `services/meta_service.py` (reservado
para lo que sí hace una llamada HTTP) o reimplementados en el flujo de envío.
"""

import asyncio
import re
from collections.abc import Callable

from services.media_library_service import get_media_asset
from services.media_storage import read_media_bytes
from services.meta_service import (
    MetaApiError,
    describe_template_error,
    upload_header_media,
)
from services.whatsapp_rules import (
    LIMITS as INTERACTIVE_LIMITS,
    MAX_TEXT_LENGTH,
    InteractiveRuleError,
    normalize_interactive_config,
    resolve_interactive_footer,
)


class TemplateValidationError(ValueError):
    """Lo que mandó el formulario no se puede guardar."""


class TemplateMediaError(Exception):
    """Meta rechazó la subida del encabezado."""


ALLOWED_INTERNAL_VARIABLES = {"nombre", "telefono", "servicio", "vendedor", "fecha_actual"}
MAX_TEMPLATE_NAME_LENGTH = 120
MAX_SHORTCUT_LENGTH = 50
MAX_CATEGORY_LENGTH = 60
MAX_OFFICIAL_HEADER_TEXT_LENGTH = 60
MAX_OFFICIAL_FOOTER_LENGTH = 60
MAX_OFFICIAL_BUTTON_TEXT_LENGTH = 25
MAX_OFFICIAL_BUTTON_URL_LENGTH = 2000

INTERNAL_DEFAULTS = {
    "official_name": None,
    "official_language": None,
    "official_category": None,
    "official_status": None,
    "official_parameter_values": [],
    "official_header_type": "none",
    "official_header_text": None,
    "official_header_media_asset_id": None,
    "official_footer": None,
    "official_buttons": [],
}


def template_parameter_identifiers(content: str) -> list[str]:
    """Identificadores de variable del body de una plantilla oficial, en el
    orden en que Meta los espera al armar el `components` de un envío.

    Meta soporta dos formatos de variable en el body de una plantilla:
    posicional (`{{1}}`, `{{2}}`, ...) y con nombre (`{{customer_name}}`).
    Esta app solo arma plantillas posicionales al crearlas acá, pero una
    importada desde el WhatsApp Manager (ver `routers/templates.py
    _parse_meta_template`) puede venir en cualquiera de los dos formatos, y
    hay que distinguirlos: un envío con parámetros posicionales llanos
    (`{"type": "text", "text": ...}`) contra una plantilla con nombre falla
    con el código 132012 ("Parameter format does not match format in the
    created template") -- para esas hace falta agregar `parameter_name` a
    cada parámetro (ver `services/chat_messaging.py`/`routers/chats.py`).

    Si todas las variables encontradas son numéricas se asume posicional
    clásico y se devuelve una entrada por posición distinta (1..máximo,
    tolerando que una posición se repita en el texto); si alguna tiene
    nombre, se devuelve cada aparición literal en el orden del texto, porque
    ese es el orden en el que se le va a pedir el valor al admin/vendedor."""
    matches = re.findall(r"\{\{\s*([^{}]+?)\s*\}\}", content)
    if matches and all(match.isdigit() for match in matches):
        highest = max(int(match) for match in matches)
        return [str(position) for position in range(1, highest + 1)]
    return matches


def render_official_body(content: str, parameter_values: list[str]) -> str:
    """Sustituye cada variable del body de una plantilla oficial por su valor
    real, para guardar/mostrar el mensaje tal como se lo mandó a Meta.

    Es la única fuente confiable de "qué se mandó": ni el webhook de
    entrada (n8n reenvía eventos del cliente y cambios de estado, nunca el
    contenido de un mensaje que la propia app mandó) ni la respuesta de
    `POST /messages` (`_send` solo devuelve `{contacts, messages:[{id}]}`,
    sin el body) tienen el texto ya resuelto -- Meta jamás lo hace eco. Hay
    que armarlo acá, con el mismo criterio posicional/con nombre que
    `template_parameter_identifiers`, antes de encolar el envío."""
    identifiers = template_parameter_identifiers(content)
    if identifiers and all(name.isdigit() for name in identifiers):
        mapping = dict(zip(identifiers, parameter_values))
        return re.sub(r"\{\{\s*(\d+)\s*\}\}", lambda m: mapping.get(m.group(1), m.group(0)), content)
    values = iter(parameter_values)
    return re.sub(r"\{\{\s*[^{}]+?\s*\}\}", lambda _match: next(values, _match.group(0)), content)


def template_variables(value: object) -> set[str]:
    if isinstance(value, str):
        return {match.strip() for match in re.findall(r"\{\{\s*([^{}]+?)\s*\}\}", value)}
    if isinstance(value, list):
        return set().union(*(template_variables(item) for item in value)) if value else set()
    if isinstance(value, dict):
        return set().union(*(template_variables(item) for item in value.values())) if value else set()
    return set()


def validate_internal_variables(*values: object) -> None:
    unknown = set().union(*(template_variables(value) for value in values)) - ALLOWED_INTERNAL_VARIABLES
    if unknown:
        formatted = ", ".join(f"{{{{{name}}}}}" for name in sorted(unknown))
        raise TemplateValidationError(f"Variables no reconocidas: {formatted}")


def normalize_common_fields(values: dict) -> None:
    name = str(values.get("name") or "").strip()
    content = str(values.get("content") or "").strip()
    category = str(values.get("category") or "").strip()
    shortcut = str(values.get("shortcut") or "").strip().lstrip("/").lower() or None
    if not name or not content or not category:
        raise TemplateValidationError("Nombre, contenido y categoría son obligatorios")
    if len(name) > MAX_TEMPLATE_NAME_LENGTH:
        raise TemplateValidationError(f"El nombre admite máximo {MAX_TEMPLATE_NAME_LENGTH} caracteres")
    if len(category) > MAX_CATEGORY_LENGTH:
        raise TemplateValidationError(f"La categoría admite máximo {MAX_CATEGORY_LENGTH} caracteres")
    if shortcut and (
        len(shortcut) > MAX_SHORTCUT_LENGTH or not re.fullmatch(r"[a-z0-9_-]+", shortcut)
    ):
        raise TemplateValidationError(
            f"El atajo admite máximo {MAX_SHORTCUT_LENGTH} caracteres: letras minúsculas, números, - y _",
        )

    interactive = values.get("template_type", "internal") == "internal" and values.get("interactive_type") != "none"
    content_limit = INTERACTIVE_LIMITS.body if interactive or values.get("template_type") == "official" else MAX_TEXT_LENGTH
    if len(content) > content_limit:
        raise TemplateValidationError(
            f"El contenido admite máximo {content_limit} caracteres para este tipo de plantilla"
        )

    values.update({"name": name, "content": content, "category": category, "shortcut": shortcut})


async def _validate_interactive_config(values: dict) -> None:
    interactive_type = values.get("interactive_type") or "none"
    config = values.get("interactive_config") or {}
    try:
        footer = "" if interactive_type == "none" else await resolve_interactive_footer(interactive_type, config)
        values["interactive_config"] = normalize_interactive_config(interactive_type, config, footer)
    except InteractiveRuleError as exc:
        raise TemplateValidationError(str(exc)) from exc
    values["interactive_type"] = interactive_type


async def _header_text(values: dict) -> None:
    header_text = str(values.get("official_header_text") or "").strip()
    if not header_text:
        raise TemplateValidationError("El encabezado de texto no puede estar vacío")
    if len(header_text) > MAX_OFFICIAL_HEADER_TEXT_LENGTH:
        raise TemplateValidationError(
            f"El encabezado admite máximo {MAX_OFFICIAL_HEADER_TEXT_LENGTH} caracteres"
        )
    if template_variables(header_text):
        raise TemplateValidationError("El encabezado de una plantilla oficial no admite variables")
    values.update({
        "official_header_type": "text",
        "official_header_text": header_text,
        "official_header_media_asset_id": None,
    })


async def _header_image(values: dict) -> None:
    asset_id = values.get("official_header_media_asset_id")
    if not asset_id:
        raise TemplateValidationError("Selecciona una imagen para el encabezado")
    asset = await get_media_asset(asset_id)
    if asset is None:
        raise TemplateValidationError(
            "El archivo elegido para el encabezado ya no existe en la librería de medios"
        )
    if not asset["content_type"].startswith("image/"):
        raise TemplateValidationError("El encabezado con imagen solo admite archivos de imagen")
    values.update({
        "official_header_type": "image",
        "official_header_text": None,
        "official_header_media_asset_id": asset_id,
    })


async def _header_none(values: dict) -> None:
    values.update({
        "official_header_type": "none",
        "official_header_text": None,
        "official_header_media_asset_id": None,
    })


OFFICIAL_HEADER_RULES: dict[str, Callable[[dict], object]] = {
    "text": _header_text,
    "image": _header_image,
    "none": _header_none,
}


def _button_quick_reply(item: dict, result: dict) -> dict:
    return result


def _button_url(item: dict, result: dict) -> dict:
    url = str(item.get("url") or "").strip()
    if not re.fullmatch(r"https://[^\s]+", url, flags=re.IGNORECASE):
        raise TemplateValidationError("Las URL de botones deben ser completas y comenzar con https://")
    if len(url) > MAX_OFFICIAL_BUTTON_URL_LENGTH:
        raise TemplateValidationError(f"La URL admite máximo {MAX_OFFICIAL_BUTTON_URL_LENGTH} caracteres")
    if template_variables(url):
        raise TemplateValidationError("Las URL de botones oficiales no admiten variables en esta versión")
    return {**result, "url": url}


def _button_phone(item: dict, result: dict) -> dict:
    phone = re.sub(r"[\s()\-]", "", str(item.get("phone_number") or ""))
    if not re.fullmatch(r"\+?[1-9]\d{7,14}", phone):
        raise TemplateValidationError(
            "El teléfono del botón debe incluir código de país y tener entre 8 y 15 dígitos"
        )
    return {**result, "phone_number": phone}


OFFICIAL_BUTTON_RULES: dict[str, Callable[[dict, dict], dict]] = {
    "quick_reply": _button_quick_reply,
    "url": _button_url,
    "phone_number": _button_phone,
}

META_BUTTON_BUILDERS: dict[str, Callable[[dict], dict]] = {
    "quick_reply": lambda button: {"type": "QUICK_REPLY", "text": button["text"]},
    "url": lambda button: {"type": "URL", "text": button["text"], "url": button["url"]},
    "phone_number": lambda button: {
        "type": "PHONE_NUMBER", "text": button["text"], "phone_number": button["phone_number"],
    },
}


def _normalize_official_buttons(values: dict) -> None:
    buttons = values.get("official_buttons") if isinstance(values.get("official_buttons"), list) else []
    if len(buttons) > 3:
        raise TemplateValidationError("Una plantilla oficial admite como máximo 3 botones")
    has_quick_reply = any(isinstance(item, dict) and item.get("type") == "quick_reply" for item in buttons)
    if has_quick_reply and any(isinstance(item, dict) and item.get("type") != "quick_reply" for item in buttons):
        raise TemplateValidationError(
            "Los botones de respuesta rápida no pueden mezclarse con botones de URL o teléfono"
        )
    if not has_quick_reply and len(buttons) > 2:
        raise TemplateValidationError("Una plantilla oficial admite como máximo 2 botones de URL o teléfono")

    normalized: list[dict] = []
    seen_texts: set[str] = set()
    for item in buttons:
        rule = OFFICIAL_BUTTON_RULES.get(item.get("type")) if isinstance(item, dict) else None
        if rule is None:
            raise TemplateValidationError("Tipo de botón no soportado en plantillas oficiales")
        text = str(item.get("text") or "").strip()
        if not text or text.lower() in seen_texts:
            raise TemplateValidationError("Cada botón necesita un texto único")
        if len(text) > MAX_OFFICIAL_BUTTON_TEXT_LENGTH:
            raise TemplateValidationError(
                f"El texto de cada botón admite máximo {MAX_OFFICIAL_BUTTON_TEXT_LENGTH} caracteres"
            )
        seen_texts.add(text.lower())
        normalized.append(rule(item, {"type": item["type"], "text": text}))
    values["official_buttons"] = normalized


async def validate_official_components(values: dict) -> None:
    header_type = values.get("official_header_type") or "none"
    await OFFICIAL_HEADER_RULES.get(header_type, _header_none)(values)

    footer = str(values.get("official_footer") or "").strip()
    if footer:
        if len(footer) > MAX_OFFICIAL_FOOTER_LENGTH:
            raise TemplateValidationError(f"El pie admite máximo {MAX_OFFICIAL_FOOTER_LENGTH} caracteres")
        if template_variables(footer):
            raise TemplateValidationError("El pie de una plantilla oficial no admite variables")
    values["official_footer"] = footer or None

    _normalize_official_buttons(values)


def _validate_official_text(values: dict) -> tuple[str, str, list[str]]:
    official_name = (values.get("official_name") or "").strip().lower()
    official_language = (values.get("official_language") or "").strip()
    if not re.fullmatch(r"[a-z0-9_]+", official_name):
        raise TemplateValidationError("El nombre oficial solo admite minúsculas, números y guiones bajos")
    if not official_language:
        raise TemplateValidationError("El idioma oficial es obligatorio")
    if len(official_name) > 512:
        raise TemplateValidationError("El nombre oficial admite máximo 512 caracteres")
    if not re.fullmatch(r"[a-z]{2,3}(?:_[A-Z]{2})?", official_language):
        raise TemplateValidationError("El idioma oficial debe tener un formato como es, es_PE o en_US")
    if not values.get("official_category"):
        raise TemplateValidationError("La categoría oficial es obligatoria")

    # Una plantilla creada desde cero acá siempre usa variables posicionales
    # ({{1}}, {{2}}, ...), consecutivas -- es el único formato que esta app
    # sabe armar al mandarla a Meta. Una importada desde el WhatsApp Manager
    # (`routers/templates.py post_import_meta_template`) puede traer variables
    # con nombre tal como Meta ya la aprobó, pero ese camino no pasa por acá
    # -- valida el conteo aparte y no vuelve a exigir el formato posicional.
    positions = sorted({int(value) for value in re.findall(r"\{\{(\d+)\}\}", values.get("content") or "")})
    if any(not value.isdigit() for value in template_variables(values.get("content"))):
        raise TemplateValidationError(
            "El contenido oficial solo admite variables numéricas como {{1}}, {{2}}, ..."
        )
    expected_positions = list(range(1, (positions[-1] if positions else 0) + 1))
    if positions != expected_positions:
        raise TemplateValidationError("Las variables oficiales deben ser consecutivas: {{1}}, {{2}}, ...")
    parameters = [str(value).strip() for value in values.get("official_parameter_values") or []]
    if len(parameters) != len(expected_positions) or any(not value for value in parameters):
        raise TemplateValidationError(
            f"Debes configurar un valor para cada una de las {len(expected_positions)} variables oficiales"
        )
    validate_internal_variables(parameters)
    return official_name, official_language, parameters


async def validate_template_values(values: dict) -> dict:
    normalize_common_fields(values)
    if values.get("template_type", "internal") == "internal":
        values.update(INTERNAL_DEFAULTS)
        await _validate_interactive_config(values)
        validate_internal_variables(values["content"], values["interactive_config"])
        return values

    official_name, official_language, parameters = _validate_official_text(values)
    values.update({
        "official_name": official_name,
        "official_language": official_language,
        "official_parameter_values": parameters,
        "interactive_type": "none",
        "interactive_config": {},
    })
    await validate_official_components(values)
    return values


async def build_meta_components(values: dict) -> list[dict]:
    """Arma el `components` que espera la Graph API de Meta a partir de los
    campos ya validados de una plantilla oficial. Evolution lo pasa tal cual
    (confirmado en `template.service.ts` 2.3.7), así que el formato acá tiene
    que ser exactamente el de Meta, no el interno de esta app.

    Un encabezado de imagen exige que Meta ya tenga el archivo antes de crear
    la plantilla (el `header_handle` del resumable upload) — Evolution no
    tiene equivalente de esto, así que acá se sube directo a la Graph API."""
    components: list[dict] = []
    header_type = values.get("official_header_type")
    if header_type == "text" and values.get("official_header_text"):
        components.append({"type": "HEADER", "format": "TEXT", "text": values["official_header_text"]})
    elif header_type == "image" and values.get("official_header_media_asset_id"):
        asset = await get_media_asset(values["official_header_media_asset_id"])
        if asset is None:
            raise TemplateValidationError(
                "El archivo elegido para el encabezado ya no existe en la librería de medios"
            )
        content = await asyncio.to_thread(read_media_bytes, asset["media_url"])
        try:
            handle = await upload_header_media(content, asset["content_type"], asset["filename"])
        except MetaApiError as exc:
            raise TemplateMediaError(describe_template_error(exc)) from exc
        components.append({"type": "HEADER", "format": "IMAGE", "example": {"header_handle": [handle]}})
    components.append({"type": "BODY", "text": values["content"]})
    if values.get("official_footer"):
        components.append({"type": "FOOTER", "text": values["official_footer"]})
    buttons = values.get("official_buttons") or []
    if buttons:
        components.append({
            "type": "BUTTONS",
            "buttons": [META_BUTTON_BUILDERS[button["type"]](button) for button in buttons],
        })
    return components
