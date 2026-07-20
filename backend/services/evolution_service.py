import httpx
from services.settings_service import get_effective


class EvolutionApiError(Exception):
    pass


def mediatype_from_content_type(content_type: str) -> str:
    if content_type.startswith("image/"):
        return "image"
    if content_type.startswith("video/"):
        return "video"
    if content_type.startswith("audio/"):
        return "audio"
    return "document"


async def _config() -> tuple[str, str, str]:
    api_url = await get_effective("evolution_api_url")
    api_key = await get_effective("evolution_api_key")
    instance = await get_effective("evolution_instance")
    if not (api_url and api_key and instance):
        raise EvolutionApiError(
            "Evolution API no está configurada (URL / API key / instancia)"
        )
    return api_url, api_key, instance


async def _post(url: str, api_key: str, payload: dict, timeout: float) -> dict:
    """POST a Evolution API. Si responde con error, la excepción incluye el
    body de la respuesta (no solo el status code) — sin esto, un 400 por un
    payload mal formado es indistinguible de cualquier otro error y hay que
    ir a probar con curl a mano para saber qué se quejó realmente."""
    headers = {"apikey": api_key}
    async with httpx.AsyncClient(timeout=timeout) as client:
        response = await client.post(url, json=payload, headers=headers)
        if response.is_error:
            raise EvolutionApiError(f"Evolution API respondió {response.status_code}: {response.text}")
        return response.json()


async def get_template_capabilities() -> dict:
    """Detecta si la instancia usa la integración Meta de Evolution.

    Evolution expone sendTemplate en el router general, pero el adaptador
    Baileys responde "Method not available". Se consulta la instancia para
    poder explicarlo antes de que el usuario intente enviar.
    """
    api_url, api_key, instance = await _config()
    url = f"{api_url.rstrip('/')}/instance/fetchInstances"
    headers = {"apikey": api_key}
    async with httpx.AsyncClient(timeout=20.0) as client:
        response = await client.get(url, headers=headers)
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
    return {
        "integration": normalized,
        "official_sending_supported": supported,
        "reason": None if supported else (
            "La instancia de Evolution usa Baileys. Las plantillas oficiales requieren "
            "una instancia con integración WHATSAPP-BUSINESS (Meta Cloud API)."
        ),
    }


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
