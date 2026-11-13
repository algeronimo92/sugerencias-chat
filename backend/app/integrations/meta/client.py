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
_META_ERROR_CODE_BSUID_UNSUPPORTED = 131062  # tipo de mensaje que exige número


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


class RecipientNeedsPhoneError(MetaApiError):
    """Meta no acepta este mensaje para un contacto identificado solo por su
    BSUID (código 131062): las plantillas de autenticación exigen número."""

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
    if code == _META_ERROR_CODE_BSUID_UNSUPPORTED:
        raise RecipientNeedsPhoneError(
            "Este contacto escribe con nombre de usuario y no compartió su número; "
            "WhatsApp no permite enviarle este tipo de mensaje sin número.",
            error=error, status_code=response.status_code,
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


NOTICE_NUMBER_KEY = "appointment_notice_phone_number_id"
# La WABA del número de avisos cuando no es la del CRM. En coexistencia Meta
# no deja elegir una WABA existente: el registro crea una nueva en el
# portfolio del negocio (pasó al vincular el número de avisos de DermicaPro).
NOTICE_WABA_KEY = "appointment_notice_waba_id"


async def _owner_business(waba_id: str, token: str) -> str | None:
    body = await _request(
        "GET", _graph_url(waba_id), token, params={"fields": "owner_business_info"}, timeout=20.0,
    )
    return ((body or {}).get("owner_business_info") or {}).get("id")


async def _resolve_phone_number_id(waba_id: str, access_token: str, *, exclude: set[str] | None = None) -> str:
    """El evento de coexistencia (`FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`)
    solo trae `waba_id` -- a diferencia del embedded signup normal, Meta no
    manda el `phone_number_id` por `postMessage` porque el número ya existía
    de antes en la app de WhatsApp Business, no se creó en este flujo. Hay
    que resolverlo aparte con `GET /{waba_id}/phone_numbers`.

    Con el número de avisos de cita la WABA tiene dos números: ``exclude``
    descarta el que ya tiene otro papel (el de avisos al vincular el del CRM,
    y al revés) para que quede uno solo."""
    body = await _request(
        "GET", _graph_url(f"{waba_id}/phone_numbers"), access_token,
        params={"fields": "id"}, timeout=20.0,
    )
    numbers = [item for item in body.get("data") or [] if item.get("id") not in (exclude or set())]
    if len(numbers) == 1:
        return numbers[0]["id"]
    if not numbers:
        raise MetaApiError(f"La WABA {waba_id} no tiene ningún número de teléfono nuevo todavía")
    raise MetaApiError(
        f"La WABA {waba_id} tiene {len(numbers)} números posibles y no se puede elegir uno solo "
        "automáticamente; elígelo a mano"
    )


async def _exchange_code(code: str) -> str:
    """Cambia el `code` de un solo uso de `FB.login()` por un token de acceso."""
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
    return access_token


async def complete_notice_number_signup(
    code: str, waba_id: str, phone_number_id: str | None = None,
) -> dict[str, str]:
    """El Embedded Signup (también con coexistencia) del número de avisos de
    cita. A diferencia de ``complete_embedded_signup`` no guarda nada: el
    token, la WABA y el número del CRM quedan como estaban, y devuelve
    ``{phone_number_id, waba_id}`` del número vinculado para que se elija
    como número de avisos.

    Puede quedar en la WABA del CRM o en otra del mismo portfolio (en
    coexistencia Meta siempre crea una nueva). El token del CRM es del
    usuario del sistema de la app y el registro le da acceso también a la
    WABA nueva, así que sirve para enviar desde las dos. Otro portfolio sería
    otro negocio y se rechaza."""
    access_token = await _exchange_code(code)
    token, crm_number, crm_waba = await _config()
    if waba_id != crm_waba:
        crm_business = await _owner_business(crm_waba, token)
        notice_business = await _owner_business(waba_id, token)
        if not crm_business or crm_business != notice_business:
            raise MetaApiError(
                "El número quedó en una cuenta de WhatsApp Business de otro portfolio comercial. "
                "Vuelve a vincularlo eligiendo el portfolio del negocio"
            )
    # Sin esto la WABA no manda webhooks a esta app; con el CRM ya vinculado
    # la suscripción existe y repetirla no cambia nada.
    await _request("POST", _graph_url(f"{waba_id}/subscribed_apps"), access_token, timeout=20.0)
    if not phone_number_id:
        phone_number_id = await _resolve_phone_number_id(waba_id, access_token, exclude={crm_number})
    if phone_number_id == crm_number:
        raise MetaApiError("Ese es el número del CRM: vincula otro número para los avisos")
    return {"phone_number_id": phone_number_id, "waba_id": waba_id}


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
    access_token = await _exchange_code(code)

    # Sin esto la WABA no manda webhooks (mensajes entrantes, estados) a esta
    # app -- paso obligatorio de Embedded Signup, ver docs de Meta.
    await _request("POST", _graph_url(f"{waba_id}/subscribed_apps"), access_token, timeout=20.0)

    if not phone_number_id:
        # Con número de avisos la WABA tiene dos números: el de avisos nunca
        # es el del CRM.
        notice_number = (await get_effective_many((NOTICE_NUMBER_KEY,)))[NOTICE_NUMBER_KEY]
        phone_number_id = await _resolve_phone_number_id(
            waba_id, access_token, exclude={notice_number} if notice_number else None,
        )

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


async def _recipient(chat_id: str) -> dict[str, str]:
    """Campo de destino del lead: ``to`` con su ``wa_id`` o ``recipient`` con
    su BSUID.

    Un contacto con nombre de usuario puede escribir sin mostrar su número y
    solo se lo conoce por el ``user_id`` (BSUID) que manda Meta. Desde julio de
    2026 la Cloud API acepta ese id en ``recipient``. Si hay número se sigue
    usando ``to``: es lo que Meta prioriza si llegan los dos, y las plantillas
    de autenticación solo van por número.
    """
    destination = await resolve_whatsapp_destination(chat_id)
    if destination.wa_id:
        return {"to": destination.wa_id}
    if destination.user_id:
        # Tal cual llegó: el prefijo de país y el punto son parte del id.
        return {"recipient": destination.user_id}
    raise MetaApiError(f"El lead {chat_id} no tiene wa_id ni user_id de WhatsApp")


async def send_message(chat_id: str, message: dict) -> dict:
    """POST /{phone_number_id}/messages con el cuerpo Meta ya validado.

    Devuelve ``{"body": cuerpo exacto enviado, "response": respuesta de Meta}``.
    """
    return await _post_message(await _recipient(chat_id), message)


async def send_message_to_number(wa_id: str, message: dict, *, sender_phone_number_id: str | None = None) -> dict:
    """Lo mismo que ``send_message`` pero a un número que no es un lead (el
    aviso de cita al equipo). Antes ese aviso pasaba el número como si fuera
    el id de un lead, la búsqueda de la identidad fallaba con 'invalid UUID'
    y no le llegaba a nadie.

    ``sender_phone_number_id`` sale desde otro número de la misma WABA (el
    número de avisos) con el mismo token; sin él, desde el número del CRM."""
    return await _post_message({"to": wa_id}, message, sender_phone_number_id=sender_phone_number_id)


async def send_message_to_lead_from(chat_id: str, message: dict, *, sender_phone_number_id: str) -> dict:
    """Al lead, pero desde el número de avisos y sin pasar por su chat."""
    return await _post_message(await _recipient(chat_id), message, sender_phone_number_id=sender_phone_number_id)


async def list_phone_numbers(waba_id: str | None = None) -> list[dict]:
    """Los números de una WABA (la del CRM si no se dice otra): ``{id,
    display_phone_number, verified_name, waba_id}``. El de avisos sale de
    la WABA del CRM o de la suya propia."""
    token, _phone_number_id, crm_waba = await _config()
    waba_id = waba_id or crm_waba
    body = await _request(
        "GET", _graph_url(f"{waba_id}/phone_numbers"), token,
        params={"fields": "id,display_phone_number,verified_name"}, timeout=20.0,
    )
    return [
        {
            "id": str(item["id"]),
            "display_phone_number": str(item.get("display_phone_number") or ""),
            "verified_name": str(item.get("verified_name") or ""),
            "waba_id": waba_id,
        }
        for item in body.get("data") or []
        if isinstance(item, dict) and item.get("id")
    ]


async def get_waba_name(waba_id: str) -> str:
    token, _phone_number_id, _crm_waba = await _config()
    body = await _request("GET", _graph_url(waba_id), token, params={"fields": "name"}, timeout=20.0)
    return str((body or {}).get("name") or "")


async def register_extra_number(phone_number_id: str, waba_id: str | None = None) -> None:
    """Registra en el plano de control un número que no es el del CRM (el de
    avisos), para que sus estados de entrega encuentren el negocio. Sus
    mensajes entrantes no abren chats (ver ``meta_webhook.processor``). Con
    su propia WABA, esa WABA también rutea sus eventos de plantillas."""
    context = get_current_tenant()
    if context is None:
        return
    _token, _crm_number, crm_waba = await _config()
    from app.tenancy.provisioning import sync_whatsapp_connection

    await sync_whatsapp_connection(
        context.organization_id, phone_number_id=phone_number_id, waba_id=waba_id or crm_waba,
    )


async def unregister_extra_number(phone_number_id: str) -> None:
    """Lo contrario de ``register_extra_number``. Nunca toca el número del
    CRM: sus webhooks son los chats."""
    context = get_current_tenant()
    if context is None:
        return
    _token, crm_number, _waba_id = await _config()
    if phone_number_id == crm_number:
        return
    from app.tenancy.provisioning import disable_whatsapp_connection

    await disable_whatsapp_connection(context.organization_id, phone_number_id=phone_number_id)


async def _post_message(
    recipient: dict[str, str], message: dict, *, sender_phone_number_id: str | None = None,
) -> dict:
    token, phone_number_id, _waba_id = await _config()
    phone_number_id = sender_phone_number_id or phone_number_id
    body = {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        **recipient,
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


async def upload_media(
    content: bytes, content_type: str, filename: str, *, sender_phone_number_id: str | None = None,
) -> str:
    """Sube un adjunto de mensaje normal (no encabezado de plantilla) a Meta y
    devuelve el media id: ``POST /{phone_number_id}/media`` (multipart) y
    recién después el mensaje con ``{tipo: {"id": media_id}}``. El id solo
    vale para el número que lo subió: un envío desde el número de avisos
    tiene que subirlo con ese número."""
    token, phone_number_id, _waba_id = await _config()
    phone_number_id = sender_phone_number_id or phone_number_id
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


_MEDIA_HEADER_FORMATS = {"IMAGE", "VIDEO", "DOCUMENT"}


async def copy_whatsapp_template(meta_template_id: str, waba_id: str) -> dict:
    """Crea en otra WABA (la del número de avisos) una copia de una plantilla
    de la WABA del CRM, con el mismo nombre, idioma, categoría y contenido:
    un envío desde un número solo encuentra las plantillas de su WABA, y con
    el mismo nombre el aviso se arma igual. Meta la revisa de nuevo.

    El ejemplo de un encabezado con imagen viene como URL descargable y la
    creación exige un ``header_handle``: se baja y se vuelve a subir."""
    original = await get_whatsapp_template(meta_template_id)
    components: list[dict] = []
    for component in original.get("components") or []:
        component = dict(component)
        if component.get("type") == "HEADER" and component.get("format") in _MEDIA_HEADER_FORMATS:
            urls = (component.get("example") or {}).get("header_handle") or []
            if not urls:
                raise MetaApiError(f"La plantilla {original.get('name')} no trae el ejemplo de su encabezado")
            content, content_type = await download_template_header_example(urls[0])
            extension = content_type.rsplit("/", 1)[-1] or "bin"
            handle = await upload_header_media(content, content_type, f"encabezado.{extension}")
            component["example"] = {"header_handle": [handle]}
        components.append(component)
    token, _phone_number_id, _crm_waba = await _config()
    payload = {
        "name": original.get("name"),
        "category": original.get("category"),
        "language": original.get("language"),
        "components": components,
    }
    return await _request(
        "POST", _graph_url(f"{waba_id}/message_templates"), token, json_body=payload, timeout=30.0,
    )


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


async def list_whatsapp_templates(waba_id: str | None = None) -> list[dict]:
    """Trae del lado de Meta el estado real de las plantillas de la WABA
    conectada (u otra, la del número de avisos) con `GET
    /{waba_id}/message_templates`, siguiendo `paging.next` hasta agotarlo:
    una WABA puede tener más de 100 plantillas."""
    token, _phone_number_id, crm_waba = await _config()
    waba_id = waba_id or crm_waba
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


# Con TIER, PRICING_CATEGORY y COUNTRY Meta detalla el tramo de volumen de
# cada punto; sin COUNTRY el tramo no aparece.
_PRICING_DIMENSIONS = '["PRICING_CATEGORY","PRICING_TYPE","COUNTRY","TIER"]'


async def fetch_pricing_analytics(start: datetime, end: datetime) -> dict:
    """Lo que Meta cobró a la WABA del negocio entre ``start`` y ``end``, por
    día, categoría, tipo de precio, país y tramo.

    Devuelve ``{"currency": str | None, "data_points": [...]}`` con los puntos
    tal como los manda Meta (``start``, ``end``, ``volume``, ``cost``,
    ``country``, ``pricing_category``, ``pricing_type``, ``tier``). ``cost`` va
    en la moneda de la WABA y Meta lo da por aproximado.
    """
    token, _phone_number_id, waba_id = await _config()
    analytics = (
        f"pricing_analytics.start({int(start.timestamp())}).end({int(end.timestamp())})"
        f".granularity(DAILY).dimensions({_PRICING_DIMENSIONS})"
    )
    body = await _request(
        "GET", _graph_url(waba_id), token,
        params={"fields": f"currency,{analytics}"}, timeout=30.0,
    )
    points: list[dict] = []
    for block in ((body.get("pricing_analytics") or {}).get("data") or []):
        points.extend(point for point in (block.get("data_points") or []) if isinstance(point, dict))
    return {"currency": body.get("currency"), "data_points": points}
