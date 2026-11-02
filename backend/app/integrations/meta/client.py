import asyncio
from datetime import datetime, timezone
import logging
from time import perf_counter
from typing import Any

import httpx

from app.core.request_metrics import record_external_duration
from app.modules.auth.ports.account_actions import (try_send_operational_alert)
from app.modules.platform.ports.platform_settings import (platform_setting, platform_settings_many)
from app.modules.platform.ports.settings_service import (get_effective_many, update_settings)
from app.integrations.whatsapp.channel import ChannelError, DeliveryUnconfirmedError
from app.integrations.meta_webhook import metrics
from app.integrations.whatsapp.identity import resolve_whatsapp_destination
from app.tenancy.context import get_current_tenant

logger = logging.getLogger(__name__)

GRAPH_API_VERSION = "v26.0"

# Códigos de error de la Graph API ya vistos en tráfico real de esta app.
_META_ERROR_CODE_WINDOW_CLOSED = 131047  # ventana de 24h del contacto cerrada
_META_ERROR_CODE_SCHEMA_VIOLATION = 100  # ej. botón no-reply fuera de plantilla
_META_ERROR_CODE_AUTH = 190  # token vencido o inválido


class MetaApiError(ChannelError):
    """Rechazo real de la Graph API (HTTP 4xx/5xx). ``error`` es el objeto
    ``error`` de Meta sin modificar."""

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
    mensaje apto para el admin, leyendo el objeto ``error`` de Meta."""
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
    metrics.outbound_meta_errors.labels(code=str(code)).inc()
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


async def _config() -> tuple[str, str, str]:
    """-> (access_token, phone_number_id, waba_id)."""
    values = await get_effective_many((
        "meta_access_token", "meta_phone_number_id", "meta_waba_id",
    ))
    access_token = values["meta_access_token"]
    phone_number_id = values["meta_phone_number_id"]
    waba_id = values["meta_waba_id"]
    if not (access_token and phone_number_id and waba_id):
        day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        await try_send_operational_alert(
            event_key=f"whatsapp-disconnected:{day}",
            event_type="whatsapp_disconnected",
            subject="WhatsApp necesita reconectarse",
            title="WhatsApp no está conectado",
            message=(
                "Falta una credencial necesaria de Meta Cloud API. Un administrador debe "
                "conectar WhatsApp desde Configuración para reanudar los envíos."
            ),
        )
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
    values = await platform_settings_many(("meta_app_id", "meta_app_secret"))
    app_id, app_secret = values["meta_app_id"], values["meta_app_secret"]
    if not (app_id and app_secret):
        raise MetaApiError(
            "Faltan el Facebook App ID y App Secret de la plataforma para completar el signup"
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

    # Los webhooks entrantes llegan a una URL común y se rutean por
    # `phone_number_id`, que se resuelve en el plano de control antes de conocer
    # el schema. Guardar el token en el `app_settings` del negocio no alcanza:
    # sin esta fila activa, los eventos de este número no encuentran su tenant.
    context = get_current_tenant()
    if context is not None:
        # Import local: provisioning arrastra db_service/ws_manager y este
        # módulo lo cargan ellos de vuelta al enviar mensajes.
        from app.tenancy.provisioning import sync_whatsapp_connection

        await sync_whatsapp_connection(
            context.organization_id,
            phone_number_id=phone_number_id,
            waba_id=waba_id,
        )


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
        try:
            _raise_meta_error(response)
        except MetaInvalidTokenException:
            # Una credencial de Meta inválida equivale a WhatsApp desconectado
            # para los envíos. Se avisa una vez por día hasta reconectar; el
            # fallo del correo nunca oculta el error original de Meta.
            day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
            await try_send_operational_alert(
                event_key=f"whatsapp-disconnected:{day}",
                event_type="whatsapp_disconnected",
                subject="WhatsApp necesita reconectarse",
                title="La conexión de WhatsApp se interrumpió",
                message=(
                    "Meta rechazó la credencial del negocio. Un administrador debe "
                    "volver a conectar WhatsApp desde Configuración para reanudar los envíos."
                ),
            )
            raise
    return response.json()


async def _recipient(chat_id: str) -> str:
    """``wa_id`` exacto del lead para el campo ``to``.

    Un contacto conocido solo por su ``user_id`` (nombre de usuario activo,
    sin teléfono informado) no tiene un destino al que este envío pueda
    apuntar: falla explícito en vez de mandar algo que Meta rechazaría.
    """
    destination = await resolve_whatsapp_destination(chat_id)
    if destination.wa_id:
        return destination.wa_id
    raise MetaApiError(
        f"El lead {chat_id} solo tiene user_id de WhatsApp, sin wa_id; "
        "Meta no permite enviarle por número todavía."
    )


async def send_message(chat_id: str, message: dict) -> dict:
    """POST /{phone_number_id}/messages con el cuerpo Meta ya validado.

    Devuelve ``{"body": cuerpo exacto enviado, "response": respuesta de Meta}``.
    """
    token, phone_number_id, _waba_id = await _config()
    body = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": await _recipient(chat_id),
        **message,
    }
    url = _graph_url(f"{phone_number_id}/messages")
    try:
        response = await _request("POST", url, token, json_body=body, timeout=60.0)
    except _REQUEST_NOT_SENT_ERRORS:
        raise
    except (httpx.TransportError, ValueError) as exc:
        raise DeliveryUnconfirmedError() from exc
    return {"body": body, "response": response}


async def upload_media(content: bytes, content_type: str, filename: str) -> str:
    """Sube un adjunto de mensaje normal (no encabezado de plantilla) a Meta y
    devuelve el media id: ``POST /{phone_number_id}/media`` (multipart) y
    recién después el mensaje con ``{tipo: {"id": media_id}}``."""
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
    app_id = await platform_setting("meta_app_id")
    if not app_id:
        raise MetaApiError(
            "Falta configurar el Facebook App ID (Tech Provider) en la plataforma "
            "para poder subir encabezados con imagen"
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
    `{"id","status","category"}`."""
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
    hasta agotarlo: una WABA puede tener más de 100 plantillas."""
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


async def mark_messages_as_read(chat_id: str, wa_message_ids: list[str]) -> dict:
    """Le avisa a WhatsApp que ya se vieron estos mensajes del cliente —
    hace que le aparezcan los tiques azules de "leído" de su lado. Meta no
    tiene una versión en lote: se marcan uno por uno."""
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
