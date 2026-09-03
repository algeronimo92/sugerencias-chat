import asyncio
import logging
from typing import Any

import httpx
from time import monotonic, perf_counter
from services.performance import record_external_duration
from services.settings_service import get_effective_many
from services.whatsapp_identity_service import (
    learn_send_aliases,
    resolve_history_jid,
    resolve_whatsapp_destination,
)

logger = logging.getLogger(__name__)


class EvolutionApiError(Exception):
    pass


class WhatsAppWindowClosedError(EvolutionApiError):
    """Meta rechazó un envío libre porque la ventana de 24h del contacto ya
    cerró (código 131047 de la Graph API). Sólo se da en instancias con
    integración WHATSAPP-BUSINESS; sólo una plantilla aprobada puede
    reabrirla."""


_META_ERROR_CODE_WINDOW_CLOSED = 131047


def _raise_if_send_rejected(result: Any) -> None:
    """Detecta un rechazo de Meta disfrazado de envío exitoso.

    En una instancia WHATSAPP-BUSINESS, el helper `post()` de Evolution
    (whatsapp.business.service.ts) atrapa el error de axios cuando Meta
    rechaza el POST a /messages —por ejemplo con el 131047 de "ventana de 24h
    cerrada"— y devuelve el objeto de error de Meta tal cual, con el mismo
    HTTP 200/201 que un envío real. No hay forma de detectarlo por status
    code: sólo por la forma del body.

    Un envío real (Baileys o Business) siempre trae `key.id`, y su campo
    `message` es el objeto del mensaje (un dict), nunca un string. El error
    de Meta, en cambio, no trae `key` y sí trae `code` (int) + `message`
    (string) — la forma de un error de la Graph API
    (`{message, type, code, error_subcode, fbtrace_id, ...}`). Se exige esa
    combinación exacta para no dar falsos positivos sobre una forma de éxito
    que todavía no se conoce.
    """
    if not isinstance(result, dict):
        return
    if (result.get("key") or {}).get("id"):
        return
    code = result.get("code")
    message = result.get("message")
    if not isinstance(code, int) or not isinstance(message, str):
        return
    if code == _META_ERROR_CODE_WINDOW_CLOSED:
        raise WhatsAppWindowClosedError(
            "La ventana de 24 h para responder libremente a este contacto está "
            "cerrada. Mandale una plantilla aprobada para reabrir la conversación."
        )
    raise EvolutionApiError(f"Meta rechazó el envío: {message} (código {code})")


_http_client: httpx.AsyncClient | None = None
_capabilities_cache: tuple[float, dict] | None = None


def _client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            limits=httpx.Limits(max_connections=100, max_keepalive_connections=20),
        )
    return _http_client


async def close_evolution_client() -> None:
    global _http_client
    if _http_client is not None:
        await _http_client.aclose()
        _http_client = None


def mediatype_from_content_type(content_type: str) -> str:
    if content_type.startswith("image/"):
        return "image"
    if content_type.startswith("video/"):
        return "video"
    if content_type.startswith("audio/"):
        return "audio"
    return "document"


def media_message_fields(
    mediatype: str, filename: str | None, album_id: str | None = None,
) -> tuple[str, dict | None]:
    """Deriva (message_type, payload) para un adjunto saliente.

    El mediatype (image/video/audio/document) ya es un message_type válido; solo
    document necesita conservar el nombre en payload, porque WhatsApp no le da
    caption y ese nombre es lo único que lo identifica del lado del receptor.
    Fuente única de este mapeo para los dos caminos de envío (el encolado del
    outbox y el envío síncrono de las automatizaciones).

    `album_id` viaja cuando el CRM mandó varias fotos/videos juntos desde un
    mismo picker (ver ChatComposer): WhatsApp no tiene forma de agrupar eso del
    lado del cliente (Evolution API no expone envío de álbum nativo), pero acá
    sí se puede agrupar en grilla de forma exacta en vez de adivinar por
    tiempo — ver utils/mediaGroups.ts en el frontend."""
    payload: dict = {}
    if mediatype == "document" and filename:
        payload["filename"] = filename
    if album_id:
        payload["album_id"] = album_id
    return mediatype, payload or None


async def _config() -> tuple[str, str, str]:
    values = await get_effective_many((
        "evolution_api_url",
        "evolution_api_key",
        "evolution_instance",
    ))
    api_url = values["evolution_api_url"]
    api_key = values["evolution_api_key"]
    instance = values["evolution_instance"]
    if not (api_url and api_key and instance):
        raise EvolutionApiError(
            "Evolution API no está configurada (URL / API key / instancia)"
        )
    return api_url, api_key, instance


async def is_configured() -> bool:
    """True si están cargadas URL, API key e instancia. Lo usa la UI de
    conexión para no intentar pedir el QR sin credenciales."""
    values = await get_effective_many((
        "evolution_api_url",
        "evolution_api_key",
        "evolution_instance",
    ))
    return all(values.values())


async def _request(method: str, url: str, api_key: str, payload: dict, timeout: float) -> Any:
    """Llamada con cuerpo JSON a Evolution API. Si responde con error, la
    excepción incluye el body de la respuesta (no solo el status code) — sin
    esto, un 400 por un payload mal formado es indistinguible de cualquier otro
    error y hay que ir a probar con curl a mano para saber qué se quejó
    realmente.

    El método es un parámetro porque no todo va por POST: eliminar un mensaje
    es un DELETE *con* cuerpo (ver delete_whatsapp_message)."""
    headers = {"apikey": api_key}
    started_at = perf_counter()
    try:
        response = await _client().request(
            method, url, json=payload, headers=headers, timeout=timeout
        )
    finally:
        record_external_duration("evolution", (perf_counter() - started_at) * 1000)
    if response.is_error:
        raise EvolutionApiError(f"Evolution API respondió {response.status_code}: {response.text}")
    return response.json()


async def _post(url: str, api_key: str, payload: dict, timeout: float) -> Any:
    return await _request("POST", url, api_key, payload, timeout)


async def _post_to_chat(
    chat_id: str, url: str, api_key: str, payload: dict, timeout: float
) -> Any:
    """Envía a un chat y aprende, de la respuesta, cómo lo direcciona WhatsApp.

    La ``key`` que devuelve Evolution trae el JID real del chat —con el
    direccionamiento por LID, casi siempre un ``@lid``— junto al teléfono en
    ``remoteJidAlt``. Registrar ese par es lo que evita que el mismo contacto
    quede partido en dos leads (uno creado por el entrante con el LID, otro por
    el saliente con el teléfono) y lo que permite pedirle el historial a
    Evolution con el JID bajo el que realmente lo indexa.

    Va acá y no en cada llamador porque todos los caminos de envío —outbox,
    automatizaciones, plantillas— pasan por estas funciones.
    """
    result = await _post(url, api_key, payload, timeout)
    _raise_if_send_rejected(result)
    try:
        await learn_send_aliases(chat_id, result)
    except Exception:
        # El mensaje ya salió: un fallo anotando alias no puede convertir un
        # envío exitoso en un error para el vendedor.
        logger.exception("No se pudieron registrar los alias del envío a %s", chat_id)
    return result


async def get_instance_capabilities() -> dict:
    """Detecta qué admite la instancia activa según su integración de Evolution.

    Una sola llamada (`GET /instance/fetchInstances`, cacheada 5 min) contesta
    varias preguntas a la vez, porque todas dependen del mismo dato: si la
    instancia es `WHATSAPP-BUSINESS` (Meta Cloud API) o Baileys (WhatsApp Web).

    - `official_sending_supported`: Evolution expone `sendTemplate` en el
      router general, pero el adaptador Baileys responde "Method not
      available" — hace falta Business. Es la única bandera que ya se
      consultaba antes de generalizar esta función (se llamaba
      `get_template_capabilities`).
    - `history_available`: Meta Cloud API no tiene equivalente de
      `chat/findMessages` — el historial retroactivo solo existe en Baileys.
    - `edit_delete_supported`: Meta Cloud API no soporta editar ni "eliminar
      para todos" un mensaje saliente vía API — solo Baileys.
    """
    global _capabilities_cache
    if _capabilities_cache and _capabilities_cache[0] > monotonic():
        return _capabilities_cache[1]
    api_url, api_key, instance = await _config()
    url = f"{api_url.rstrip('/')}/instance/fetchInstances"
    headers = {"apikey": api_key}
    started_at = perf_counter()
    try:
        response = await _client().get(url, headers=headers, timeout=20.0)
    finally:
        record_external_duration("evolution", (perf_counter() - started_at) * 1000)
    if response.is_error:
        raise EvolutionApiError(
            f"Evolution API respondió {response.status_code} al consultar la instancia"
        )
    rows = response.json()

    integration = None
    for row in rows if isinstance(rows, list) else []:
        row_name = row.get("name") or (row.get("instance") or {}).get("instanceName")
        if row_name == instance:
            integration = row.get("integration") or (row.get("instance") or {}).get("integration")
            break
    normalized = str(integration).upper() if integration else None
    is_business = normalized == "WHATSAPP-BUSINESS"
    # Si no se pudo determinar la integración (la instancia no apareció en
    # fetchInstances), se restringe todo por igual en vez de asumir Baileys
    # por default: es el mismo criterio conservador que ya usaba
    # official_sending_supported (False cuando no está confirmado), ahora
    # aplicado también a las banderas que son "todo menos Business".
    is_known = normalized is not None
    result = {
        "integration": normalized,
        "official_sending_supported": is_business,
        "history_available": is_known and not is_business,
        "edit_delete_supported": is_known and not is_business,
        "reason": None if is_business else (
            "La instancia de Evolution usa Baileys. Las plantillas oficiales requieren "
            "una instancia con integración WHATSAPP-BUSINESS (Meta Cloud API)."
        ),
    }
    _capabilities_cache = (monotonic() + 300.0, result)
    return result


async def check_whatsapp_numbers(numbers: list[str]) -> list[dict]:
    """Consulta si los números (solo dígitos, con código de país) existen en
    WhatsApp. Devuelve la lista cruda de Evolution: [{exists, jid, number}, …].
    Timeout corto a propósito: el alta de leads no puede quedar rehén de una
    instancia colgada (el llamador hace fail-open ante EvolutionApiError)."""
    api_url, api_key, instance = await _config()
    url = f"{api_url.rstrip('/')}/chat/whatsappNumbers/{instance}"
    result = await _post(url, api_key, {"numbers": numbers}, timeout=10.0)
    return result if isinstance(result, list) else []


async def find_phone_jid_for_lid(lid_jid: str) -> str | None:
    """Intenta resolver un LID usando los contactos sincronizados por Evolution.

    Es una ayuda best-effort: algunas versiones conservan contactos incompletos
    o desactualizados. Solo se acepta ``number`` como teléfono; nunca se usan
    los dígitos del propio LID.

    El filtro va por ``remoteJid``, que es donde vive el JID: el campo ``id`` de
    un contacto es una clave interna de Evolution (un cuid, no un JID), así que
    filtrar por ahí no devuelve nunca nada.

    Comprobado en Evolution 2.3.7 con direccionamiento por LID: el contacto de
    un ``@lid`` trae solo ``remoteJid``, ``pushName`` y la foto — ningún
    teléfono. Ahí esta función devuelve None y el lead nace sin número; la vía
    que sí resuelve la equivalencia es ``learn_send_aliases``, que la lee de la
    respuesta de un envío. Se conserva porque sigue sirviendo en instancias sin
    LID, donde el contacto sí trae ``number``.
    """
    if not lid_jid.endswith("@lid"):
        return None
    api_url, api_key, instance = await _config()
    url = f"{api_url.rstrip('/')}/chat/findContacts/{instance}"
    result = await _post(
        url, api_key, {"where": {"remoteJid": lid_jid}, "take": 5}, timeout=10.0
    )
    if isinstance(result, dict):
        rows = result.get("records") or result.get("data") or result.get("contacts") or []
    else:
        rows = result
    if not isinstance(rows, list):
        return None

    lid_digits = lid_jid.removesuffix("@lid")
    for row in rows:
        if not isinstance(row, dict):
            continue
        number = str(row.get("number") or "").strip().lower()
        if number.endswith("@lid"):
            continue
        if number.endswith("@s.whatsapp.net"):
            digits = number.removesuffix("@s.whatsapp.net")
        else:
            digits = "".join(character for character in number if character.isdigit())
        if 8 <= len(digits) <= 15 and digits != lid_digits:
            return f"{digits}@s.whatsapp.net"
    return None


HISTORY_PAGE_SIZE = 50


async def find_chat_messages(chat_id: str, page: int, limit: int = HISTORY_PAGE_SIZE) -> Any:
    """Historial crudo de un chat tal como lo guarda WhatsApp.

    Evolution devuelve los mensajes del más nuevo al más viejo. La forma de la
    respuesta cambió entre versiones (lista plana vs. objeto paginado), así que
    acá se devuelve sin tocar y la normalización queda en `whatsapp_history`.

    El JID de consulta no es el de envío: WhatsApp indexa por LID aunque se le
    escriba al teléfono (ver `resolve_history_jid`).
    """
    api_url, api_key, instance = await _config()
    url = f"{api_url.rstrip('/')}/chat/findMessages/{instance}"
    destination = await resolve_history_jid(chat_id)
    payload = {"where": {"key": {"remoteJid": destination}}, "page": page, "offset": limit}
    return await _post(url, api_key, payload, timeout=30.0)


async def send_whatsapp_template(
    chat_id: str,
    name: str,
    language: str,
    components: list[dict],
) -> dict:
    capabilities = await get_instance_capabilities()
    if not capabilities["official_sending_supported"]:
        raise EvolutionApiError(capabilities["reason"] or "La instancia no admite plantillas oficiales")
    api_url, api_key, instance = await _config()
    destination = await resolve_whatsapp_destination(chat_id)
    url = f"{api_url.rstrip('/')}/message/sendTemplate/{instance}"
    payload = {
        "number": destination,
        "name": name,
        "language": language,
        "components": components,
    }
    return await _post_to_chat(chat_id, url, api_key, payload, timeout=30.0)


async def send_whatsapp_buttons(
    chat_id: str,
    title: str,
    description: str,
    footer: str,
    buttons: list[dict],
) -> dict:
    api_url, api_key, instance = await _config()
    destination = await resolve_whatsapp_destination(chat_id)
    url = f"{api_url.rstrip('/')}/message/sendButtons/{instance}"
    payload = {
        "number": destination,
        "title": title,
        "description": description,
        "buttons": buttons,
    }
    payload["footer"] = footer.strip() or "DermicaPro"
    return await _post_to_chat(chat_id, url, api_key, payload, timeout=30.0)


async def send_whatsapp_list(
    chat_id: str,
    title: str,
    description: str,
    footer_text: str,
    button_text: str,
    sections: list[dict],
) -> dict:
    api_url, api_key, instance = await _config()
    destination = await resolve_whatsapp_destination(chat_id)
    url = f"{api_url.rstrip('/')}/message/sendList/{instance}"
    payload = {
        "number": destination,
        "title": title,
        "description": description,
        "footerText": footer_text.strip() or "DermicaPro",
        "buttonText": button_text,
        "sections": sections,
    }
    return await _post_to_chat(chat_id, url, api_key, payload, timeout=30.0)


def _with_quoted(payload: dict, quoted: dict | None, destination: str) -> dict:
    """Agrega el contexto de cita al payload si lo hay.

    Evolution acepta `quoted` como opción de nivel superior en todos los
    endpoints de envío y se lo pasa a Baileys, que es quien arma el
    contextInfo. Va condicionado porque mandar `quoted: null` hace que
    Evolution rechace el envío con 400 en vez de ignorarlo.
    """
    if not quoted:
        return payload
    key = quoted.get("key") if isinstance(quoted, dict) else None
    if isinstance(key, dict):
        # quoted_context usa el lead.id interno; Evolution solo entiende JID.
        # Reemplazarlo siempre también tolera payloads legados que ya traían JID.
        quoted = {**quoted, "key": {**key, "remoteJid": destination}}
    return {**payload, "quoted": quoted}


async def send_whatsapp_text(chat_id: str, text: str, quoted: dict | None = None) -> dict:
    api_url, api_key, instance = await _config()
    destination = await resolve_whatsapp_destination(chat_id)

    url = f"{api_url.rstrip('/')}/message/sendText/{instance}"
    # El CRM opera con lead.id; Evolution recibe el mejor JID externo asociado.
    payload = _with_quoted({"number": destination, "text": text}, quoted, destination)
    return await _post_to_chat(chat_id, url, api_key, payload, timeout=30.0)


async def send_whatsapp_location(
    chat_id: str,
    latitude: float,
    longitude: float,
    name: str | None = None,
    address: str | None = None,
    quoted: dict | None = None,
) -> dict:
    """name/address están documentados como opcionales en Evolution API,
    pero en la práctica el servidor los exige igual (400 "instance requires
    property name/address" si se omiten) — siempre van con algún valor.
    No mostramos lat/lon crudas ahí: el pin de ubicación de WhatsApp ya
    funciona como link a Maps, así que la dirección solo sería ruido."""
    api_url, api_key, instance = await _config()
    destination = await resolve_whatsapp_destination(chat_id)

    url = f"{api_url.rstrip('/')}/message/sendLocation/{instance}"
    payload = _with_quoted({
        "number": destination,
        "latitude": latitude,
        "longitude": longitude,
        "name": name or "",
        "address": address or "",
    }, quoted, destination)
    return await _post_to_chat(chat_id, url, api_key, payload, timeout=30.0)


async def send_whatsapp_media(
    chat_id: str,
    media_base64: str,
    mediatype: str,
    filename: str | None = None,
    caption: str | None = None,
    quoted: dict | None = None,
) -> dict:
    """Manda un adjunto genérico (imagen, video, audio, o documento).
    mediatype le dice a Evolution API cómo procesarlo.

    También es el camino para audio saliente en general: el endpoint
    sendWhatsAppAudio (PTT, nota de voz nativa) quedó roto en la integración
    Meta Cloud API de esta instancia -acepta el envío pero el mensaje nunca
    se entrega ni progresa un solo estado, sin ningún error- así que
    mediatype="audio" es lo que realmente entrega, a cambio de perder la
    burbuja nativa de nota de voz del lado del destinatario.

    filename es el nombre original elegido por el usuario: importa sobre
    todo para documentos, para que el destinatario vea el nombre real (y es
    obligatorio para audio: sin fileName Evolution devuelve 500).
    caption es el epígrafe (el texto que va debajo de la imagen/video)."""
    api_url, api_key, instance = await _config()
    destination = await resolve_whatsapp_destination(chat_id)

    url = f"{api_url.rstrip('/')}/message/sendMedia/{instance}"
    payload = {"number": destination, "mediatype": mediatype, "media": media_base64}
    if filename:
        payload["fileName"] = filename
    if caption:
        payload["caption"] = caption
    return await _post_to_chat(
        chat_id, url, api_key, _with_quoted(payload, quoted, destination), timeout=60.0
    )


async def send_whatsapp_sticker(chat_id: str, sticker_base64: str) -> dict:
    """Manda un sticker. `sticker_base64` debe ser un WEBP (512×512, transparente)
    — la conversión la hace media_storage.image_to_sticker_webp antes de llamar."""
    api_url, api_key, instance = await _config()
    destination = await resolve_whatsapp_destination(chat_id)

    url = f"{api_url.rstrip('/')}/message/sendSticker/{instance}"
    payload = {"number": destination, "sticker": sticker_base64}
    return await _post_to_chat(chat_id, url, api_key, payload, timeout=60.0)


async def mark_messages_as_read(chat_id: str, wa_message_ids: list[str]) -> dict:
    """Le avisa a WhatsApp que ya se vieron estos mensajes del cliente —
    hace que le aparezcan los tiques azules de "leído" de su lado.
    fromMe=False siempre acá: son mensajes que el cliente mandó, no el
    vendedor (esos ya quedan "leídos" para nosotros solos, no hace falta
    avisarle a WhatsApp)."""
    api_url, api_key, instance = await _config()

    url = f"{api_url.rstrip('/')}/chat/markMessageAsRead/{instance}"
    destination = await resolve_whatsapp_destination(chat_id)
    payload = {
        "readMessages": [
            {"remoteJid": destination, "fromMe": False, "id": wa_message_id} for wa_message_id in wa_message_ids
        ]
    }
    return await _post(url, api_key, payload, timeout=30.0)


async def send_whatsapp_reaction(key: dict, emoji: str) -> dict:
    """Reacciona a un mensaje con un emoji (o lo quita si `emoji` es "").

    `key` identifica el mensaje reaccionado tal como lo espera WhatsApp:
    {remoteJid, fromMe, id}. fromMe distingue si el mensaje era del vendedor o
    del cliente — sin eso la reacción no matchea con el mensaje correcto."""
    api_url, api_key, instance = await _config()

    url = f"{api_url.rstrip('/')}/message/sendReaction/{instance}"
    remote_jid = key.get("remoteJid")
    if not isinstance(remote_jid, str) or "@" not in remote_jid:
        key = {
            **key,
            "remoteJid": await resolve_whatsapp_destination(str(remote_jid or "")),
        }
    payload = {"key": key, "reaction": emoji}
    return await _post(url, api_key, payload, timeout=30.0)


async def edit_whatsapp_message(chat_id: str, wa_message_id: str, text: str) -> dict:
    """Reescribe el texto de un mensaje propio ya enviado.

    WhatsApp solo admite editar mensajes de texto salidos de esta instancia y
    dentro de los 15 minutos; fuera de eso Evolution responde con error y el
    mensaje queda como estaba. El llamador filtra esos casos antes para poder
    explicarlos, pero el límite real lo pone WhatsApp, no la app.

    `fromMe` va fijo en True: editar un mensaje ajeno no existe en WhatsApp.
    """
    api_url, api_key, instance = await _config()
    destination = await resolve_whatsapp_destination(chat_id)

    url = f"{api_url.rstrip('/')}/chat/updateMessage/{instance}"
    payload = {
        "number": destination,
        "text": text,
        "key": {"remoteJid": destination, "fromMe": True, "id": wa_message_id},
    }
    return await _post(url, api_key, payload, timeout=30.0)


async def delete_whatsapp_message(chat_id: str, wa_message_id: str) -> dict:
    """Elimina para todos un mensaje propio ("Eliminar para todos" de WhatsApp).

    Es un DELETE *con* cuerpo, y la key va desarmada en campos sueltos (no
    anidada bajo `key` como en sendReaction): así la espera Evolution en
    /chat/deleteMessageForEveryone.
    """
    api_url, api_key, instance = await _config()
    destination = await resolve_whatsapp_destination(chat_id)

    url = f"{api_url.rstrip('/')}/chat/deleteMessageForEveryone/{instance}"
    payload = {"id": wa_message_id, "fromMe": True, "remoteJid": destination}
    return await _request("DELETE", url, api_key, payload, timeout=30.0)


# --- Vinculación de la instancia por QR ---------------------------------------
# Estos endpoints administran el enlace de la instancia con un teléfono
# WhatsApp (escanear el QR desde Configuración). La API key nunca sale al
# navegador: el frontend siempre pasa por estos proxies del backend.


async def get_connection_state() -> dict:
    """Estado de vinculación de la instancia.

    Normaliza a ``state``: ``open`` (vinculada), ``connecting`` (esperando el
    escaneo del QR), ``close`` (desvinculada), ``missing`` (la instancia no
    existe en Evolution) o ``unknown``.
    """
    api_url, api_key, instance = await _config()
    url = f"{api_url.rstrip('/')}/instance/connectionState/{instance}"
    headers = {"apikey": api_key}
    started_at = perf_counter()
    try:
        response = await _client().get(url, headers=headers, timeout=20.0)
    finally:
        record_external_duration("evolution", (perf_counter() - started_at) * 1000)
    if response.status_code == 404:
        return {"state": "missing", "instance": instance}
    if response.is_error:
        raise EvolutionApiError(
            f"Evolution API respondió {response.status_code} al consultar el estado: {response.text}"
        )
    data = response.json()
    state = (data.get("instance") or {}).get("state") or data.get("state")
    return {"state": state or "unknown", "instance": instance}


QR_CONNECT_ATTEMPTS = 3
QR_CONNECT_DELAY_SECONDS = 1.5


def _extract_qr(data: object) -> tuple[str | None, str | None, str | None, str | None]:
    """Saca (base64, code, pairingCode, state) de la respuesta de /connect.

    Evolution devuelve el QR plano en /connect o anidado en `qrcode` (al crear
    la instancia). El base64 a veces viene sin el prefijo `data:`."""
    if not isinstance(data, dict):
        return None, None, None, None
    qr = data["qrcode"] if isinstance(data.get("qrcode"), dict) else data
    base64 = qr.get("base64") if isinstance(qr, dict) else None
    code = qr.get("code") if isinstance(qr, dict) else None
    pairing_code = qr.get("pairingCode") if isinstance(qr, dict) else None
    state = (data.get("instance") or {}).get("state") if isinstance(data.get("instance"), dict) else data.get("state")
    if base64 and not base64.startswith("data:"):
        base64 = f"data:image/png;base64,{base64}"
    return base64, code, pairing_code, state


async def connect_instance() -> dict:
    """Pide a Evolution el QR para vincular la instancia.

    Justo después de un logout, Evolution suele tardar uno o dos intentos en
    generar el QR (lo entrega de forma asíncrona), así que se reintenta antes
    de rendirse. Si la instancia ya está vinculada no hay QR: se informa como
    tal en vez de fallar."""
    api_url, api_key, instance = await _config()
    url = f"{api_url.rstrip('/')}/instance/connect/{instance}"
    headers = {"apikey": api_key}

    last_state: str | None = None
    for attempt in range(1, QR_CONNECT_ATTEMPTS + 1):
        started_at = perf_counter()
        try:
            response = await _client().get(url, headers=headers, timeout=20.0)
        finally:
            record_external_duration("evolution", (perf_counter() - started_at) * 1000)
        if response.is_error:
            raise EvolutionApiError(
                f"Evolution API respondió {response.status_code} al pedir el QR: {response.text}"
            )
        data = response.json()
        base64, code, pairing_code, state = _extract_qr(data)
        last_state = state
        if base64:
            return {"base64": base64, "code": code, "pairing_code": pairing_code, "instance": instance, "state": state}
        if state == "open":
            # Ya vinculada: no hay QR que mostrar (el estado se refleja aparte).
            return {"base64": None, "code": None, "pairing_code": None, "instance": instance, "state": "open"}
        logger.warning(
            "connect_instance: Evolution no devolvió QR (intento %d/%d, state=%s): %r",
            attempt, QR_CONNECT_ATTEMPTS, state, data,
        )
        if attempt < QR_CONNECT_ATTEMPTS:
            await asyncio.sleep(QR_CONNECT_DELAY_SECONDS)

    raise EvolutionApiError(
        "Evolution no devolvió el código QR"
        + (f" (estado: {last_state})" if last_state else "")
        + ". Esperá unos segundos y probá de nuevo; si sigue igual, reiniciá la instancia en Evolution."
    )


async def logout_instance() -> dict:
    """Desvincula el teléfono de la instancia (cierra la sesión de WhatsApp)."""
    api_url, api_key, instance = await _config()
    url = f"{api_url.rstrip('/')}/instance/logout/{instance}"
    headers = {"apikey": api_key}
    started_at = perf_counter()
    try:
        response = await _client().delete(url, headers=headers, timeout=20.0)
    finally:
        record_external_duration("evolution", (perf_counter() - started_at) * 1000)
    if response.is_error:
        raise EvolutionApiError(
            f"Evolution API respondió {response.status_code} al desvincular: {response.text}"
        )
    return {"status": "ok", "instance": instance}
