import asyncio
import logging
from typing import Any

import httpx
from time import monotonic, perf_counter
from request_metrics import record_external_duration
from services.settings_service import get_effective_many
from services.whatsapp_channel import ChannelError
from services.whatsapp_identity_service import (
    resolve_history_jid,
    resolve_whatsapp_destination,
)

logger = logging.getLogger(__name__)

# Todo el envío de mensajes y la gestión de plantillas viven ahora en
# meta_service.py, hablándole directo a la Graph API. Lo que queda acá es lo
# que la Cloud API de Meta no ofrece y sólo existe en la sesión de Baileys:
# verificar si un número está en WhatsApp, editar y eliminar un mensaje ya
# enviado, el historial retroactivo y la vinculación por QR.


class EvolutionApiError(ChannelError):
    def __init__(self, message: str, *, status_code: int | None = None):
        super().__init__(message, status_code=status_code)


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
