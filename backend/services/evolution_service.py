import asyncio
import logging
from typing import Any

import httpx
from time import monotonic, perf_counter
from services.performance import record_external_duration
from services.settings_service import get_effective_many

logger = logging.getLogger(__name__)


class EvolutionApiError(Exception):
    pass


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


async def _post(url: str, api_key: str, payload: dict, timeout: float) -> Any:
    """POST a Evolution API. Si responde con error, la excepción incluye el
    body de la respuesta (no solo el status code) — sin esto, un 400 por un
    payload mal formado es indistinguible de cualquier otro error y hay que
    ir a probar con curl a mano para saber qué se quejó realmente."""
    headers = {"apikey": api_key}
    started_at = perf_counter()
    try:
        response = await _client().post(url, json=payload, headers=headers, timeout=timeout)
    finally:
        record_external_duration("evolution", (perf_counter() - started_at) * 1000)
    if response.is_error:
        raise EvolutionApiError(f"Evolution API respondió {response.status_code}: {response.text}")
    return response.json()


async def get_template_capabilities() -> dict:
    """Detecta si la instancia usa la integración Meta de Evolution.

    Evolution expone sendTemplate en el router general, pero el adaptador
    Baileys responde "Method not available". Se consulta la instancia para
    poder explicarlo antes de que el usuario intente enviar.
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
    supported = normalized == "WHATSAPP-BUSINESS"
    result = {
        "integration": normalized,
        "official_sending_supported": supported,
        "reason": None if supported else (
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


async def send_whatsapp_template(
    chat_id: str,
    name: str,
    language: str,
    components: list[dict],
) -> dict:
    capabilities = await get_template_capabilities()
    if not capabilities["official_sending_supported"]:
        raise EvolutionApiError(capabilities["reason"] or "La instancia no admite plantillas oficiales")
    api_url, api_key, instance = await _config()
    url = f"{api_url.rstrip('/')}/message/sendTemplate/{instance}"
    payload = {
        "number": chat_id,
        "name": name,
        "language": language,
        "components": components,
    }
    return await _post(url, api_key, payload, timeout=30.0)


async def send_whatsapp_buttons(
    chat_id: str,
    title: str,
    description: str,
    footer: str,
    buttons: list[dict],
) -> dict:
    api_url, api_key, instance = await _config()
    url = f"{api_url.rstrip('/')}/message/sendButtons/{instance}"
    payload = {
        "number": chat_id,
        "title": title,
        "description": description,
        "buttons": buttons,
    }
    payload["footer"] = footer.strip() or "DermicaPro"
    return await _post(url, api_key, payload, timeout=30.0)


async def send_whatsapp_list(
    chat_id: str,
    title: str,
    description: str,
    footer_text: str,
    button_text: str,
    sections: list[dict],
) -> dict:
    api_url, api_key, instance = await _config()
    url = f"{api_url.rstrip('/')}/message/sendList/{instance}"
    payload = {
        "number": chat_id,
        "title": title,
        "description": description,
        "footerText": footer_text.strip() or "DermicaPro",
        "buttonText": button_text,
        "sections": sections,
    }
    return await _post(url, api_key, payload, timeout=30.0)


async def send_whatsapp_text(chat_id: str, text: str) -> dict:
    api_url, api_key, instance = await _config()

    url = f"{api_url.rstrip('/')}/message/sendText/{instance}"
    # chat_id ya es el remoteJid completo (ej. 5491112345678@s.whatsapp.net);
    # Evolution API v2 acepta ese formato directo en "number".
    payload = {"number": chat_id, "text": text}
    return await _post(url, api_key, payload, timeout=30.0)


async def send_whatsapp_audio(chat_id: str, audio_base64: str) -> dict:
    """Manda una nota de voz (PTT) — endpoint específico de Evolution API,
    distinto de mandar un audio como adjunto genérico."""
    api_url, api_key, instance = await _config()

    url = f"{api_url.rstrip('/')}/message/sendWhatsAppAudio/{instance}"
    payload = {"number": chat_id, "audio": audio_base64}
    return await _post(url, api_key, payload, timeout=60.0)


async def send_whatsapp_location(
    chat_id: str,
    latitude: float,
    longitude: float,
    name: str | None = None,
    address: str | None = None,
) -> dict:
    """name/address están documentados como opcionales en Evolution API,
    pero en la práctica el servidor los exige igual (400 "instance requires
    property name/address" si se omiten) — siempre van con algún valor.
    No mostramos lat/lon crudas ahí: el pin de ubicación de WhatsApp ya
    funciona como link a Maps, así que la dirección solo sería ruido."""
    api_url, api_key, instance = await _config()

    url = f"{api_url.rstrip('/')}/message/sendLocation/{instance}"
    payload = {
        "number": chat_id,
        "latitude": latitude,
        "longitude": longitude,
        "name": name or "",
        "address": address or "",
    }
    return await _post(url, api_key, payload, timeout=30.0)


async def send_whatsapp_media(
    chat_id: str, media_base64: str, mediatype: str, filename: str | None = None
) -> dict:
    """Manda un adjunto genérico (imagen, video, audio como archivo, o
    documento). mediatype le dice a Evolution API cómo procesarlo —
    distinto de sendWhatsAppAudio, que siempre es nota de voz (PTT).
    filename es el nombre original elegido por el usuario: importa sobre
    todo para documentos, para que el destinatario vea el nombre real."""
    api_url, api_key, instance = await _config()

    url = f"{api_url.rstrip('/')}/message/sendMedia/{instance}"
    payload = {"number": chat_id, "mediatype": mediatype, "media": media_base64}
    if filename:
        payload["fileName"] = filename
    return await _post(url, api_key, payload, timeout=60.0)


async def mark_messages_as_read(chat_id: str, wa_message_ids: list[str]) -> dict:
    """Le avisa a WhatsApp que ya se vieron estos mensajes del cliente —
    hace que le aparezcan los tiques azules de "leído" de su lado.
    fromMe=False siempre acá: son mensajes que el cliente mandó, no el
    vendedor (esos ya quedan "leídos" para nosotros solos, no hace falta
    avisarle a WhatsApp)."""
    api_url, api_key, instance = await _config()

    url = f"{api_url.rstrip('/')}/chat/markMessageAsRead/{instance}"
    payload = {
        "readMessages": [
            {"remoteJid": chat_id, "fromMe": False, "id": wa_message_id} for wa_message_id in wa_message_ids
        ]
    }
    return await _post(url, api_key, payload, timeout=30.0)


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
