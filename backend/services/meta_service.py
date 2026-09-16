import asyncio
import logging
import re
from time import perf_counter
from typing import Any

import httpx

from request_metrics import record_external_duration
from services.settings_service import get_effective_many, update_settings
from services.whatsapp_channel import ChannelError, DeliveryUnconfirmedError
from services.whatsapp_identity_service import learn_send_aliases, resolve_whatsapp_destination

logger = logging.getLogger(__name__)

GRAPH_API_VERSION = "v26.0"

# Códigos de error de la Graph API ya vistos en tráfico real de esta app.
_META_ERROR_CODE_WINDOW_CLOSED = 131047  # ventana de 24h del contacto cerrada
_META_ERROR_CODE_SCHEMA_VIOLATION = 100  # ej. botón no-reply fuera de plantilla
_META_ERROR_CODE_AUTH = 190  # token vencido o inválido


class MetaApiError(ChannelError):
    """Rechazo real de la Graph API (HTTP 4xx/5xx), a diferencia del Evolution
    de antes -que a veces devolvía un rechazo de Meta como HTTP 200- acá el
    status code siempre es confiable."""

    def __init__(self, message: str, *, error: dict | None = None, status_code: int | None = None):
        super().__init__(message, status_code=status_code)
        self.error = error or {}


class WhatsAppWindowClosedError(MetaApiError):
    """Meta rechazó un envío libre porque la ventana de 24h del contacto ya
    cerró (código 131047). Sólo una plantilla aprobada puede reabrirla."""

    def __init__(self, message: str, *, error: dict | None = None, status_code: int | None = None):
        super().__init__(message, error=error, status_code=status_code)
        self.user_message = message


class MetaInvalidTokenException(MetaApiError):
    """Rechazo de solicitud por token invalido o vencido"""

    def __init__(self, message: str, *, error: dict | None = None, status_code: int | None = None):
        super().__init__(message, error=error, status_code=status_code)
        self.user_message = message


def describe_template_error(exc: Exception) -> str:
    """Convierte un rechazo de la Graph API al crear/editar una plantilla en un
    mensaje apto para el admin.

    A diferencia de Evolution (que solo daba un string con el JSON crudo
    incrustado y había que reparsearlo), acá `MetaApiError.error` ya trae el
    objeto `error` de Meta sin tocar."""
    if not isinstance(exc, MetaApiError):
        return str(exc)
    error = exc.error
    message = (
        error.get("error_user_msg")
        or (error.get("error_data") or {}).get("details")
        or error.get("message")
    )
    return str(message) if message else str(exc)


def _raise_meta_error(response: httpx.Response) -> None:
    try:
        body = response.json()
    except ValueError:
        body = {}
    error = body.get("error") if isinstance(body, dict) else None
    error = error if isinstance(error, dict) else {}
    code = error.get("code")
    message = error.get("message") or response.text
    if code == _META_ERROR_CODE_WINDOW_CLOSED:
        raise WhatsAppWindowClosedError(
            "La ventana de 24 h para responder libremente a este contacto está "
            "cerrada. Mandale una plantilla aprobada para reabrir la conversación.",
            error=error, status_code=response.status_code,
        )
    if code == _META_ERROR_CODE_AUTH:
        raise MetaInvalidTokenException(
            "Token invalido o vencido, genera uno nuevo", error=error, status_code=response.status_code
            )
    
    raise MetaApiError(
        f"Meta Graph API respondió {response.status_code}: {message} (código {code})",
        error=error, status_code=response.status_code,
    )


_REQUEST_NOT_SENT_ERRORS = (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout)


_http_client: httpx.AsyncClient | None = None


def _client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
        )
    return _http_client


async def close_meta_client() -> None:
    global _http_client
    if _http_client is not None:
        await _http_client.aclose()
        _http_client = None


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
    cada parámetro (ver `send_whatsapp_template`/`routers/chats.py`).

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


async def _config() -> tuple[str, str, str]:
    """-> (access_token, phone_number_id, waba_id)."""
    values = await get_effective_many((
        "meta_access_token", "meta_phone_number_id", "meta_waba_id",
    ))
    access_token = values["meta_access_token"]
    phone_number_id = values["meta_phone_number_id"]
    waba_id = values["meta_waba_id"]
    if not (access_token and phone_number_id and waba_id):
        raise MetaApiError(
            "Meta Cloud API no está configurada (token / phone number id / WABA id)"
        )
    return access_token, phone_number_id, waba_id


async def is_configured() -> bool:
    values = await get_effective_many((
        "meta_access_token", "meta_phone_number_id", "meta_waba_id",
    ))
    return all(values.values())


async def _resolve_phone_number_id(waba_id: str, access_token: str) -> str:
    """El evento de coexistencia (`FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`)
    solo trae `waba_id` -- a diferencia del embedded signup normal, Meta no
    manda el `phone_number_id` por `postMessage` porque el número ya existía
    de antes en la app de WhatsApp Business, no se creó en este flujo. Hay
    que resolverlo aparte con `GET /{waba_id}/phone_numbers`."""
    body = await _request(
        "GET", _graph_url(f"{waba_id}/phone_numbers"), access_token,
        params={"fields": "id"}, timeout=20.0,
    )
    numbers = body.get("data") or []
    if len(numbers) == 1:
        return numbers[0]["id"]
    if not numbers:
        raise MetaApiError(f"La WABA {waba_id} no tiene ningún número de teléfono todavía")
    raise MetaApiError(
        f"La WABA {waba_id} tiene {len(numbers)} números; completá el Phone Number ID "
        "a mano en Configuración → Claves porque no se puede elegir uno solo automáticamente"
    )


async def complete_embedded_signup(code: str, waba_id: str, phone_number_id: str | None = None) -> None:
    """Cierra el flujo de WhatsApp Embedded Signup: cambia el `code` de un
    solo uso que dio `FB.login()` por un token de acceso, suscribe esta app a
    los webhooks de la WABA elegida y guarda las tres credenciales
    resultantes como si el admin las hubiese tipeado a mano en la pestaña
    Claves.

    `waba_id` (y, en el signup normal -no coexistencia-, `phone_number_id`)
    no los devuelve este intercambio -- llegan aparte, del evento
    `WA_EMBEDDED_SIGNUP` que Meta manda por `postMessage` al completar el
    signup en el frontend (ver WhatsappPanel.tsx). En coexistencia con la app
    de WhatsApp Business el evento es `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`
    y su payload omite `phone_number_id` a propósito -- se resuelve acá con
    `_resolve_phone_number_id`."""
    values = await get_effective_many(("meta_app_id", "meta_app_secret"))
    app_id, app_secret = values["meta_app_id"], values["meta_app_secret"]
    if not (app_id and app_secret):
        raise MetaApiError(
            "Faltan el Facebook App ID y App Secret (Tech Provider) en Configuración → "
            "Meta Cloud API para completar el signup"
        )

    started_at = perf_counter()
    try:
        exchange = await _client().get(
            _graph_url("oauth/access_token"),
            params={"client_id": app_id, "client_secret": app_secret, "code": code},
            timeout=30.0,
        )
    finally:
        record_external_duration("meta_graph", (perf_counter() - started_at) * 1000)
    if exchange.is_error:
        _raise_meta_error(exchange)
    access_token = exchange.json().get("access_token")
    if not access_token:
        raise MetaApiError("Meta no devolvió un access token para el código recibido")

    # Sin esto la WABA no manda webhooks (mensajes entrantes, estados) a esta
    # app -- paso obligatorio de Embedded Signup, ver docs de Meta.
    await _request("POST", _graph_url(f"{waba_id}/subscribed_apps"), access_token, timeout=20.0)

    if not phone_number_id:
        phone_number_id = await _resolve_phone_number_id(waba_id, access_token)

    await update_settings({
        "meta_access_token": access_token,
        "meta_waba_id": waba_id,
        "meta_phone_number_id": phone_number_id,
    })


def _graph_url(path: str) -> str:
    return f"https://graph.facebook.com/{GRAPH_API_VERSION}/{path}"


async def _request(
    method: str, url: str, token: str, *,
    json_body: dict | None = None, params: dict | None = None, timeout: float,
) -> Any:
    headers = {"Authorization": f"Bearer {token}"}
    started_at = perf_counter()
    try:
        response = await _client().request(
            method, url, json=json_body, params=params, headers=headers, timeout=timeout,
        )
    finally:
        record_external_duration("meta_graph", (perf_counter() - started_at) * 1000)
    if response.is_error:
        _raise_meta_error(response)
    return response.json()


async def _destination_digits(chat_id: str) -> str:
    """Dígitos E.164 puros (sin '+', sin sufijo JID) para el campo `to` de Meta.

    Evolution/Baileys resolvía un `@lid` de forma transparente a nivel de
    protocolo; la Graph API de Meta no acepta LIDs en `to`, solo el teléfono
    real. Un lead cuyo único identificador conocido es un `@lid` (sin teléfono
    resuelto aún) no se puede mandar por acá — falla explícito en vez de
    intentar algo que Meta rechazaría de forma confusa."""
    jid = await resolve_whatsapp_destination(chat_id)
    if jid.endswith("@s.whatsapp.net"):
        return jid.removesuffix("@s.whatsapp.net")
    raise MetaApiError(
        f"El lead {chat_id} solo tiene un identificador interno de WhatsApp (LID), "
        "sin teléfono resuelto; no se puede enviar directo por Meta Cloud API."
    )


async def _send(chat_id: str, token: str, phone_number_id: str, payload: dict, timeout: float) -> dict:
    """POST a /messages + aprendizaje de alias.

    La respuesta se envuelve con la forma `{"key": {...}}` que ya esperaban
    `message_outbox`/`whatsapp_identity_service.learn_send_aliases` de
    Evolution, para no tener que tocar esos consumidores. `contacts[0].wa_id`
    de Meta normalmente ya son los mismos dígitos del teléfono (no un LID),
    así que `learn_send_aliases` no tiene mucho que aprender de acá en
    adelante — la fuente real de alias sigue siendo lo entrante."""
    url = _graph_url(f"{phone_number_id}/messages")
    try:
        raw = await _request("POST", url, token, json_body=payload, timeout=timeout)
    except _REQUEST_NOT_SENT_ERRORS:
        raise
    except (httpx.TransportError, ValueError) as exc:
        raise DeliveryUnconfirmedError() from exc
    messages = raw.get("messages") or []
    contacts = raw.get("contacts") or []
    wa_id = (contacts[0].get("wa_id") if contacts else None) or payload.get("to")
    result = {
        "key": {
            "id": messages[0].get("id") if messages else None,
            "remoteJid": f"{wa_id}@s.whatsapp.net" if wa_id else None,
            "fromMe": True,
        },
        "raw": raw,
    }
    try:
        await learn_send_aliases(chat_id, result)
    except Exception:
        # El mensaje ya salió: un fallo anotando alias no puede convertir un
        # envío exitoso en un error para el vendedor.
        logger.exception("No se pudieron registrar los alias del envío a %s", chat_id)
    return result


async def upload_media(content: bytes, content_type: str, filename: str) -> str:
    """Sube un adjunto de mensaje normal (no encabezado de plantilla) a Meta y
    devuelve el media id para referenciarlo en el mensaje. Evolution nos
    ocultaba este paso -recibía base64 y lo resolvía ella misma-; hablando
    directo con la Graph API hace falta subir primero
    (`POST /{phone_number_id}/media`, multipart) y recién después mandar el
    mensaje con `{mediatype: {"id": media_id}}`."""
    token, phone_number_id, _waba_id = await _config()
    started_at = perf_counter()
    try:
        response = await _client().post(
            _graph_url(f"{phone_number_id}/media"),
            headers={"Authorization": f"Bearer {token}"},
            data={"messaging_product": "whatsapp", "type": content_type},
            files={"file": (filename, content, content_type)},
            timeout=60.0,
        )
    finally:
        record_external_duration("meta_graph", (perf_counter() - started_at) * 1000)
    if response.is_error:
        _raise_meta_error(response)
    media_id = response.json().get("id")
    if not media_id:
        raise MetaApiError("Meta no devolvió un id de medio válido")
    return media_id


async def download_media(media_id: str) -> tuple[bytes, str]:
    """Baja un adjunto entrante de Meta y devuelve (bytes, content_type).

    Es un flujo de dos pasos, a diferencia de Evolution -que exponía un solo
    endpoint (`getBase64FromMediaMessage`) y devolvía el base64 ya resuelto:

    1. `GET /{media_id}` -> metadata con una URL firmada temporal.
    2. `GET <esa URL>` -> los bytes. La URL igual exige el mismo Bearer, no
       es pública."""
    token, _phone_number_id, _waba_id = await _config()
    metadata = await _request("GET", _graph_url(media_id), token, timeout=30.0)
    url = metadata.get("url")
    if not url:
        raise MetaApiError(f"Meta no devolvió la URL del medio {media_id}")
    content_type = metadata.get("mime_type") or "application/octet-stream"

    started_at = perf_counter()
    try:
        response = await _client().get(
            url, headers={"Authorization": f"Bearer {token}"}, timeout=60.0,
        )
    finally:
        record_external_duration("meta_graph", (perf_counter() - started_at) * 1000)
    if response.is_error:
        _raise_meta_error(response)
    return response.content, content_type


async def download_template_header_example(url: str) -> tuple[bytes, str]:
    """Baja el archivo de ejemplo del encabezado de una plantilla ya aprobada.

    Al pedir los `components` de una plantilla existente, el `example.
    header_handle` de un HEADER tipo IMAGE ya no es el handle opaco del
    resumable upload (ver `upload_header_media`, eso es solo para crear una
    plantilla nueva) sino una URL descargable con el archivo real que Meta
    aprobó -- necesario para poder importar el encabezado con imagen de una
    plantilla creada fuera de la app (WhatsApp Manager) en vez de perderlo."""
    token, _phone_number_id, _waba_id = await _config()
    started_at = perf_counter()
    try:
        response = await _client().get(url, headers={"Authorization": f"Bearer {token}"}, timeout=60.0)
    finally:
        record_external_duration("meta_graph", (perf_counter() - started_at) * 1000)
    if response.is_error:
        raise MetaApiError(f"No se pudo descargar el ejemplo del encabezado ({response.status_code})")
    content_type = response.headers.get("content-type", "application/octet-stream").split(";", 1)[0].strip()
    return response.content, content_type


async def upload_header_media(content: bytes, content_type: str, filename: str) -> str:
    """Sube un archivo a Meta para usarlo como ejemplo del encabezado de una
    plantilla oficial (imagen/video/documento) y devuelve el `header_handle`
    que exige `POST /{waba_id}/message_templates` en ese caso.

    "Resumable upload API" documentado en
    https://developers.facebook.com/docs/graph-api/guides/upload:

    1. `POST /{app_id}/uploads` con el tamaño/tipo del archivo -> sesión.
    2. `POST /{sesión}` con el archivo en el body -> `{h: <header_handle>}`.
    """
    app_id = (await get_effective_many(("meta_app_id",)))["meta_app_id"]
    if not app_id:
        raise MetaApiError(
            "Falta configurar el Facebook App ID (Tech Provider) en Configuración → "
            "Meta Cloud API para poder subir encabezados con imagen"
        )
    token, _phone_number_id, _waba_id = await _config()
    client = _client()
    started_at = perf_counter()
    try:
        start = await client.post(
            _graph_url(f"{app_id}/uploads"),
            params={
                "file_length": len(content),
                "file_type": content_type,
                "file_name": filename,
                "access_token": token,
            },
            timeout=30.0,
        )
    finally:
        record_external_duration("meta_graph", (perf_counter() - started_at) * 1000)
    if start.is_error:
        raise MetaApiError(f"Meta rechazó la sesión de subida ({start.status_code}): {start.text}")
    session_id = start.json().get("id")
    if not session_id:
        raise MetaApiError("Meta no devolvió una sesión de subida válida")

    started_at = perf_counter()
    try:
        upload = await client.post(
            _graph_url(session_id),
            headers={"Authorization": f"OAuth {token}", "file_offset": "0"},
            content=content,
            timeout=60.0,
        )
    finally:
        record_external_duration("meta_graph", (perf_counter() - started_at) * 1000)
    if upload.is_error:
        raise MetaApiError(f"Meta rechazó la subida del archivo ({upload.status_code}): {upload.text}")
    handle = upload.json().get("h")
    if not handle:
        raise MetaApiError("Meta no devolvió un header_handle válido")
    return handle


async def create_whatsapp_template(
    name: str, category: str, language: str, components: list[dict],
) -> dict:
    """Da de alta una plantilla en Meta para revisión: `POST
    /{waba_id}/message_templates`. Devuelve la respuesta nativa de Meta,
    `{"id","status","category"}` — sin el wrapper `{"templateId","template"}`
    que armaba Evolution."""
    token, _phone_number_id, waba_id = await _config()
    url = _graph_url(f"{waba_id}/message_templates")
    payload = {
        "name": name,
        "category": category,
        "language": language,
        "components": components,
        "allow_category_change": True,
    }
    return await _request("POST", url, token, json_body=payload, timeout=30.0)


async def get_whatsapp_template(meta_template_id: str) -> dict:
    """`GET /{meta_template_id}` con los `components` completos -- a
    diferencia de `list_whatsapp_templates` (que no los pide, para no pesar
    el listado), esto trae el body/header/footer/botones tal como Meta los
    aprobó. Hace falta para importar una plantilla creada fuera de la app
    (ej. desde el WhatsApp Manager) sin tener que reconstruirla a mano."""
    token, _phone_number_id, _waba_id = await _config()
    url = _graph_url(meta_template_id)
    return await _request(
        "GET", url, token,
        params={"fields": "id,name,status,category,language,rejected_reason,components"},
        timeout=20.0,
    )


async def list_whatsapp_templates() -> list[dict]:
    """Trae del lado de Meta el estado real de las plantillas de la WABA
    conectada (`GET /{waba_id}/message_templates`), siguiendo `paging.next`
    hasta agotarlo — Evolution nunca paginaba esto, una WABA con más de 100
    plantillas rompía `/sync` en silencio para las que quedaban afuera."""
    token, _phone_number_id, waba_id = await _config()
    url = _graph_url(f"{waba_id}/message_templates")
    params: dict | None = {"fields": "id,name,status,category,language,rejected_reason", "limit": 100}
    next_url: str | None = url
    templates: list[dict] = []
    while next_url:
        started_at = perf_counter()
        try:
            response = await _client().get(
                next_url, params=params,
                headers={"Authorization": f"Bearer {token}"}, timeout=20.0,
            )
        finally:
            record_external_duration("meta_graph", (perf_counter() - started_at) * 1000)
        if response.is_error:
            _raise_meta_error(response)
        body = response.json()
        data = body.get("data")
        if isinstance(data, list):
            templates.extend(data)
        next_url = (body.get("paging") or {}).get("next")
        params = None  # la URL de "next" ya trae todos los query params
    return templates


async def update_whatsapp_template(
    meta_template_id: str, components: list[dict] | None = None, category: str | None = None,
) -> dict:
    """`POST /{meta_template_id}` — por id propio de la plantilla, no de la WABA."""
    token, _phone_number_id, _waba_id = await _config()
    url = _graph_url(meta_template_id)
    payload: dict = {}
    if components is not None:
        payload["components"] = components
    if category is not None:
        payload["category"] = category
    return await _request("POST", url, token, json_body=payload, timeout=30.0)


async def delete_whatsapp_template(name: str, meta_template_id: str | None = None) -> dict:
    token, _phone_number_id, waba_id = await _config()
    url = _graph_url(f"{waba_id}/message_templates")
    params: dict = {"name": name}
    if meta_template_id:
        params["hsm_id"] = meta_template_id
    return await _request("DELETE", url, token, params=params, timeout=20.0)


async def send_whatsapp_template(
    chat_id: str, name: str, language: str, components: list[dict],
) -> dict:
    token, phone_number_id, _waba_id = await _config()
    payload = {
        "messaging_product": "whatsapp",
        "to": await _destination_digits(chat_id),
        "type": "template",
        "template": {
            "name": name,
            "language": {"code": language},
            "components": components,
        },
    }
    return await _send(chat_id, token, phone_number_id, payload, timeout=30.0)


async def send_whatsapp_buttons(
    chat_id: str, title: str, description: str, footer: str, buttons: list[dict],
) -> dict:
    """Mensaje interactivo de botones — a diferencia de Evolution, que en su
    canal de Meta Cloud API solo mandaba `title` como cuerpo del mensaje
    (`buttonMessage()` en `whatsapp.business.service.ts`, confirmado leyendo
    su código fuente de la 2.3.7) e ignoraba `description`/`footer` por
    completo, acá los tres campos van a donde corresponden en la Graph API:
    `header.text`, `body.text`, `footer.text`. Ver
    evolution-foundation/evolution-api#2723."""
    token, phone_number_id, _waba_id = await _config()
    interactive: dict = {"type": "button", "body": {"text": description}}
    if title:
        interactive["header"] = {"type": "text", "text": title}
    footer_text = footer.strip()
    if footer_text:
        interactive["footer"] = {"text": footer_text}
    interactive["action"] = {
        "buttons": [
            {"type": "reply", "reply": {"id": button["id"], "title": button["displayText"]}}
            for button in buttons
        ],
    }
    payload = {
        "messaging_product": "whatsapp",
        "to": await _destination_digits(chat_id),
        "type": "interactive",
        "interactive": interactive,
    }
    return await _send(chat_id, token, phone_number_id, payload, timeout=30.0)


async def send_whatsapp_list(
    chat_id: str, 
    title: str, 
    description: str, 
    footer_text: str, 
    button_text: str, 
    sections: list[dict],
) -> dict:
    """`sections[].rows[].rowId` es el nombre de campo propio del DTO de
    Evolution — la Graph API de Meta espera `id`, así que se traduce acá."""
    token, phone_number_id, _waba_id = await _config()
    meta_sections = [
        {
            "title": section.get("title"),
            "rows": [
                {
                    "id": row.get("rowId"),
                    "title": row.get("title"),
                    "description": row.get("description"),
                }
                for row in section.get("rows", [])
            ],
        }
        for section in sections
    ]
    interactive: dict = {
        "type": "list",
        "body": {"text": description},
        "action": {"button": button_text, "sections": meta_sections},
    }
    if title:
        interactive["header"] = {"type": "text", "text": title}
    footer_stripped = footer_text.strip()
    if footer_stripped:
        interactive["footer"] = {"text": footer_stripped}
    payload = {
        "messaging_product": "whatsapp",
        "to": await _destination_digits(chat_id),
        "type": "interactive",
        "interactive": interactive,
    }
    return await _send(chat_id, token, phone_number_id, payload, timeout=30.0)


async def send_whatsapp_text(chat_id: str, text: str, quoted: dict | None = None) -> dict:
    token, phone_number_id, _waba_id = await _config()
    payload: dict = {
        "messaging_product": "whatsapp",
        "to": await _destination_digits(chat_id),
        "type": "text",
        "text": {"body": text},
    }
    if quoted and quoted.get("wa_message_id"):
        payload["context"] = {"message_id": quoted["wa_message_id"]}
    return await _send(chat_id, token, phone_number_id, payload, timeout=30.0)


async def send_whatsapp_location(
    chat_id: str,
    latitude: float,
    longitude: float,
    name: str | None = None,
    address: str | None = None,
    quoted: dict | None = None,
) -> dict:
    token, phone_number_id, _waba_id = await _config()
    location: dict = {"latitude": latitude, "longitude": longitude}
    if name:
        location["name"] = name
    if address:
        location["address"] = address
    payload: dict = {
        "messaging_product": "whatsapp",
        "to": await _destination_digits(chat_id),
        "type": "location",
        "location": location,
    }
    if quoted and quoted.get("wa_message_id"):
        payload["context"] = {"message_id": quoted["wa_message_id"]}
    return await _send(chat_id, token, phone_number_id, payload, timeout=30.0)


async def send_whatsapp_media(
    chat_id: str,
    content: bytes,
    content_type: str,
    mediatype: str,
    filename: str | None = None,
    caption: str | None = None,
    quoted: dict | None = None,
    voice: bool = False
) -> dict:
    token, phone_number_id, _waba_id = await _config()
    media_id = await upload_media(content, content_type, filename or "archivo")
    media_object: dict = {"id": media_id}
    if voice and mediatype == "audio":
        media_object["voice"] = voice
    if caption:
        media_object["caption"] = caption
    if filename and mediatype == "document":
        media_object["filename"] = filename
    payload: dict = {
        "messaging_product": "whatsapp",
        "to": await _destination_digits(chat_id),
        "type": mediatype,
        mediatype: media_object,
    }
    if quoted and quoted.get("wa_message_id"):
        payload["context"] = {"message_id": quoted["wa_message_id"]}
    return await _send(chat_id, token, phone_number_id, payload, timeout=60.0)


VOICE_NOTE_CONTENT_TYPE = "audio/ogg"

async def send_whatsapp_audio(
    chat_id: str,
    content: bytes,
    content_type: str,
    filename: str | None = None,
    quoted: dict | None = None,
) -> dict:
    is_voice_note = content_type.split(";", 1)[0].strip().lower() == VOICE_NOTE_CONTENT_TYPE
    return await send_whatsapp_media(
        chat_id, content, content_type, "audio",
        filename=filename, quoted=quoted, voice=is_voice_note,
    )


async def send_whatsapp_sticker(chat_id: str, sticker_bytes: bytes) -> dict:
    """Manda un sticker. `sticker_bytes` debe ser un WEBP (512×512,
    transparente) — la conversión la hace media_storage.image_to_sticker_webp
    antes de llamar."""
    token, phone_number_id, _waba_id = await _config()
    media_id = await upload_media(sticker_bytes, "image/webp", "sticker.webp")
    payload = {
        "messaging_product": "whatsapp",
        "to": await _destination_digits(chat_id),
        "type": "sticker",
        "sticker": {"id": media_id},
    }
    return await _send(chat_id, token, phone_number_id, payload, timeout=60.0)


async def mark_messages_as_read(chat_id: str, wa_message_ids: list[str]) -> dict:
    """Le avisa a WhatsApp que ya se vieron estos mensajes del cliente —
    hace que le aparezcan los tiques azules de "leído" de su lado.

    Meta no tiene una versión batch como el `readMessages` array de Evolution:
    hay que marcar uno por uno."""
    token, phone_number_id, _waba_id = await _config()
    url = _graph_url(f"{phone_number_id}/messages")
    results = await asyncio.gather(*(
        _request(
            "POST", url, token,
            json_body={"messaging_product": "whatsapp", "status": "read", "message_id": wa_message_id},
            timeout=30.0,
        )
        for wa_message_id in wa_message_ids
    ))
    return {"results": list(results)}


async def send_whatsapp_reaction(key: dict, emoji: str) -> dict:
    """Reacciona a un mensaje con un emoji (o lo quita si `emoji` es "").

    `key` identifica el mensaje reaccionado tal como lo espera el resto de la
    app: {remoteJid, fromMe, id} — mismo shape que usaban los callers de
    Evolution, para no tener que tocarlos."""
    token, phone_number_id, _waba_id = await _config()
    remote_jid = key.get("remoteJid")
    if isinstance(remote_jid, str) and "@" in remote_jid:
        digits = remote_jid.split("@", 1)[0]
    else:
        digits = await _destination_digits(str(remote_jid or ""))
    payload = {
        "messaging_product": "whatsapp",
        "to": digits,
        "type": "reaction",
        "reaction": {"message_id": key.get("id"), "emoji": emoji},
    }
    url = _graph_url(f"{phone_number_id}/messages")
    return await _request("POST", url, token, json_body=payload, timeout=30.0)
