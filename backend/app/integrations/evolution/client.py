"""Cliente HTTP de Evolution API 2.3.x."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import httpx

from app.core.config import settings
from app.integrations.whatsapp.channel import ChannelError, DeliveryUnconfirmedError
from app.modules.platform.ports.platform_settings import platform_settings_many


_PHONE_RE = re.compile(r"^[1-9][0-9]{7,14}$")
_KNOWN_STATES = {"open", "connecting", "close"}
# Igual que con Meta: si la conexión ni siquiera se estableció, el mensaje no
# salió y se puede reintentar. Un timeout posterior sí pudo entregarlo.
_REQUEST_NOT_SENT_ERRORS = (httpx.ConnectError, httpx.ConnectTimeout, httpx.PoolTimeout)


class EvolutionError(ChannelError):
    """Rechazo de Evolution ya traducido, apto para la política del outbox."""


class EvolutionUnconfirmedError(DeliveryUnconfirmedError, EvolutionError):
    """El envío pudo llegar: reintentarlo podría duplicarlo en el teléfono."""


@dataclass(frozen=True)
class EvolutionConnection:
    state: str
    instance: str | None
    qr_base64: str | None = None
    pairing_code: str | None = None


CONFIG_KEYS = (
    "evolution_api_url",
    "evolution_api_key",
    "evolution_webhook_url",
    "evolution_webhook_token",
)


async def _values() -> dict[str, str]:
    return await platform_settings_many(CONFIG_KEYS)


async def is_configured() -> bool:
    """Basta con la URL y la API key para hablar con el servidor.

    El webhook es necesario para recibir, no para vincular ni enviar: si falta,
    el panel avisa y la conexión sigue visible.
    """
    values = await _values()
    return bool(values["evolution_api_url"] and values["evolution_api_key"])


async def webhook_configured() -> bool:
    values = await _values()
    return bool(values["evolution_webhook_url"] and values["evolution_webhook_token"])


def instance_name(organization_id: UUID) -> str:
    """Nombre opaco y estable; nunca expone el teléfono del negocio."""
    return f"evolution-{organization_id.hex}"


def legacy_instance_name(organization_id: UUID) -> str:
    """Nombre que usó la primera versión local antes de ser un canal completo."""
    return f"demo-{organization_id.hex}"


async def _existing_instance(organization_id: UUID) -> tuple[str, dict[str, Any]] | None:
    """La instancia que ya existe, o None.

    Adopta la creada con el nombre anterior en vez de obligar a escanear otro
    QR: su sesión de WhatsApp sigue siendo la misma.
    """
    for name in (instance_name(organization_id), legacy_instance_name(organization_id)):
        status, payload = await _request(
            "GET", f"/instance/connectionState/{name}", allow_statuses={404}
        )
        if status != 404:
            return name, payload
    return None


def normalize_phone(value: str) -> str:
    """Acepta el formato visual habitual y produce E.164 sin el signo +."""
    normalized = re.sub(r"[\s()+.-]", "", value.strip())
    if not _PHONE_RE.fullmatch(normalized):
        raise ValueError(
            "Escribe el número con código de país, por ejemplo 51987654321"
        )
    return normalized


async def _config() -> tuple[str, str]:
    values = await _values()
    if not values["evolution_api_url"] or not values["evolution_api_key"]:
        raise EvolutionError("Evolution API no está configurada")
    return (
        values["evolution_api_url"].rstrip("/"),
        values["evolution_api_key"].strip(),
    )


async def _request(
    method: str,
    path: str,
    *,
    json: dict[str, Any] | None = None,
    params: dict[str, str] | None = None,
    allow_statuses: set[int] | None = None,
) -> tuple[int, dict[str, Any]]:
    api_url, api_key = await _config()
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.request(
                method,
                f"{api_url}{path}",
                headers={"apikey": api_key},
                json=json,
                params=params,
            )
    except _REQUEST_NOT_SENT_ERRORS:
        raise
    except httpx.TransportError as exc:
        raise EvolutionUnconfirmedError() from exc

    allowed = allow_statuses or set()
    if response.is_error and response.status_code not in allowed:
        # El body de Evolution puede contener tokens o detalles internos; no se
        # propaga al administrador ni se incorpora a la excepción.
        raise EvolutionError(
            f"Evolution API rechazó la operación ({response.status_code})",
            status_code=response.status_code,
        )
    try:
        payload = response.json()
    except ValueError:
        payload = {}
    return response.status_code, payload if isinstance(payload, dict) else {}


def _state(payload: dict[str, Any]) -> str:
    instance = payload.get("instance")
    raw = instance.get("state") if isinstance(instance, dict) else None
    raw = raw or payload.get("state") or payload.get("connectionStatus")
    normalized = str(raw).lower() if raw is not None else "unknown"
    return normalized if normalized in _KNOWN_STATES else "unknown"


def _connection_data(payload: dict[str, Any], name: str, state: str) -> EvolutionConnection:
    qrcode = payload.get("qrcode")
    qrcode = qrcode if isinstance(qrcode, dict) else {}
    base64 = payload.get("base64") or qrcode.get("base64")
    pairing_code = (
        payload.get("pairingCode")
        or payload.get("pairing_code")
        or qrcode.get("pairingCode")
        or qrcode.get("pairing_code")
    )
    return EvolutionConnection(
        state=state,
        instance=name,
        qr_base64=str(base64) if base64 else None,
        pairing_code=str(pairing_code) if pairing_code else None,
    )


async def _webhook_config() -> dict[str, Any] | None:
    values = await _values()
    if not values["evolution_webhook_url"] or not values["evolution_webhook_token"]:
        return None
    return {
        "enabled": True,
        "url": values["evolution_webhook_url"],
        "byEvents": False,
        "base64": True,
        "headers": {
            "Authorization": f"Bearer {values['evolution_webhook_token']}",
        },
        "events": [
            "MESSAGES_UPSERT",
            "MESSAGES_UPDATE",
            "SEND_MESSAGE",
            "CONNECTION_UPDATE",
        ],
    }


async def configure_webhook(instance: str) -> None:
    webhook = await _webhook_config()
    if webhook is not None:
        await _request("POST", f"/webhook/set/{instance}", json={"webhook": webhook})


async def connection_status(organization_id: UUID) -> EvolutionConnection:
    if not await is_configured():
        return EvolutionConnection(state="not_configured", instance=None)
    found = await _existing_instance(organization_id)
    if found is None:
        return EvolutionConnection(state="missing", instance=instance_name(organization_id))
    name, payload = found
    return _connection_data(payload, name, _state(payload))


async def connect(organization_id: UUID, phone: str) -> EvolutionConnection:
    normalized_phone = normalize_phone(phone)
    current = await connection_status(organization_id)
    name = current.instance or instance_name(organization_id)
    if current.state == "open":
        await configure_webhook(name)
        return current
    if current.state == "missing":
        body: dict[str, Any] = {
            "instanceName": name,
            "integration": settings.evolution_integration,
            "qrcode": True,
            "number": normalized_phone,
        }
        webhook = await _webhook_config()
        if webhook is not None:
            body["webhook"] = webhook
        await _request("POST", "/instance/create", json=body)
    else:
        await configure_webhook(name)

    _, payload = await _request(
        "GET",
        f"/instance/connect/{name}",
        params={"number": normalized_phone},
    )
    state = _state(payload)
    # La respuesta del QR normalmente no trae estado; la instancia está en
    # proceso de vinculación hasta que connectionState diga `open`.
    if state == "unknown":
        state = "connecting"
    return _connection_data(payload, name, state)


async def remove(organization_id: UUID) -> EvolutionConnection:
    if not await is_configured():
        return EvolutionConnection(state="not_configured", instance=None)
    # Logout puede responder 400 si nunca se terminó de vincular. Delete sigue
    # siendo la operación que garantiza que una conexión nueva empiece limpia.
    # Se limpian ambos nombres por si la instancia es de la versión anterior.
    names = (instance_name(organization_id), legacy_instance_name(organization_id))
    for name in names:
        await _request(
            "DELETE",
            f"/instance/logout/{name}",
            allow_statuses={400, 404},
        )
        await _request(
            "DELETE",
            f"/instance/delete/{name}",
            allow_statuses={400, 404},
        )
    return EvolutionConnection(state="missing", instance=instance_name(organization_id))


async def send_text(instance: str, number: str, text: str) -> dict[str, Any]:
    _, payload = await _request(
        "POST", f"/message/sendText/{instance}", json={"number": number, "text": text}
    )
    return payload


async def send_media(
    instance: str,
    number: str,
    *,
    mediatype: str,
    media: str,
    caption: str | None = None,
    filename: str | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "number": number,
        "mediatype": mediatype,
        "media": media,
    }
    if caption:
        body["caption"] = caption
    if filename:
        body["fileName"] = filename
    endpoint = "sendWhatsAppAudio" if mediatype == "audio" else "sendMedia"
    if mediatype == "audio":
        body = {"number": number, "audio": media}
    _, payload = await _request("POST", f"/message/{endpoint}/{instance}", json=body)
    return payload


async def mark_read(instance: str, number: str, message_ids: list[str]) -> None:
    remote_jid = f"{number}@s.whatsapp.net"
    await _request(
        "POST",
        f"/chat/markMessageAsRead/{instance}",
        json={
            "readMessages": [
                {"remoteJid": remote_jid, "fromMe": False, "id": message_id}
                for message_id in message_ids
            ]
        },
    )
