"""Cliente HTTP del ERP del negocio para las citas.

El CRM y el ERP son dos partes del mismo sistema: el ERP expone
``/api/integrations/crm/*`` para que la cita agendada acá aparezca en su
agenda. Se autentica con un token compartido que el negocio carga en
Integraciones.

Nada de esto levanta: quien llama ya guardó la cita y solo necesita saber si
el ERP la aceptó y, si no, por qué, en palabras que el vendedor entienda.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

import httpx

APPOINTMENTS_PATH = "/api/integrations/crm/appointments"
PING_PATH = "/api/integrations/crm/ping"
# El ERP guarda paciente, cita y pago en una transacción y convierte la foto
# del comprobante: holgado para eso, corto para no colgar el alta de la cita.
TIMEOUT = httpx.Timeout(20.0, connect=5.0)
MAX_ERROR_LENGTH = 300

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class ErpReply:
    ok: bool
    appointment_id: str | None = None
    error: str | None = None


def _client() -> httpx.AsyncClient:
    # Sin seguir redirecciones: reenviaría el token a donde apunte la
    # redirección, que puede no ser el ERP.
    return httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False)


def _headers(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}", "Accept": "application/json"}


def _payload(response: httpx.Response) -> dict:
    try:
        payload = response.json()
    except ValueError:
        return {}
    return payload if isinstance(payload, dict) else {}


def _rejection(response: httpx.Response) -> str:
    """Por qué el ERP no aceptó la petición. Sus errores de validación ya
    vienen en español y dicen qué corregir; se muestran tal cual."""
    status = response.status_code
    if status in (401, 403):
        return "El ERP rechazó el token de la integración: revisa que sea el mismo en los dos sistemas"
    if status == 404:
        return "En esa dirección no hay un ERP con la integración de citas"
    if 300 <= status < 400:
        return "La dirección del ERP redirige a otra: usa la dirección final"
    message = _payload(response).get("error")
    # 503 es el ERP diciendo que no tiene configurada la integración; los demás
    # 5xx son fallos suyos cuyo texto no le sirve a quien agenda.
    if isinstance(message, str) and message.strip() and (status < 500 or status == 503):
        return " ".join(message.split())[:MAX_ERROR_LENGTH]
    return f"El ERP respondió con un error ({status})"


async def _send(request) -> httpx.Response | ErpReply:
    try:
        async with _client() as client:
            return await request(client)
    except httpx.TimeoutException:
        return ErpReply(ok=False, error="El ERP no respondió a tiempo")
    except httpx.HTTPError as exc:
        # Sin el detalle de la excepción en la respuesta: puede traer la URL
        # completa. El tipo alcanza para el log.
        logger.warning("No se pudo conectar con el ERP: %s", type(exc).__name__)
        return ErpReply(ok=False, error="No se pudo conectar con el ERP")


async def ping(base_url: str, token: str) -> ErpReply:
    """Comprueba la dirección y el token sin crear nada en el ERP."""
    reply = await _send(lambda client: client.get(f"{base_url.rstrip('/')}{PING_PATH}", headers=_headers(token)))
    if isinstance(reply, ErpReply):
        return reply
    if reply.is_error or reply.is_redirect:
        return ErpReply(ok=False, error=_rejection(reply))
    data = _payload(reply).get("data")
    if not isinstance(data, dict) or data.get("ok") is not True:
        return ErpReply(ok=False, error="En esa dirección no hay un ERP con la integración de citas")
    return ErpReply(ok=True)


async def post_appointment(
    base_url: str, token: str, form: dict[str, str], receipt: tuple[str, bytes, str] | None,
) -> ErpReply:
    """Manda la cita. ``receipt`` es ``(nombre, contenido, tipo)`` del
    comprobante del adelanto. Repetir el envío es seguro: el ERP reconoce el
    ``externalId`` y devuelve la cita que ya había creado."""
    url = f"{base_url.rstrip('/')}{APPOINTMENTS_PATH}"
    # Siempre multipart, con o sin archivo: es lo que el ERP espera leer. Cada
    # campo va como parte sin nombre de archivo; mezclar ``data`` y ``files``
    # no garantiza multipart cuando no hay comprobante.
    parts: dict = {key: (None, value) for key, value in form.items()}
    if receipt:
        parts["receipt"] = receipt
    reply = await _send(lambda client: client.post(url, headers=_headers(token), files=parts))
    if isinstance(reply, ErpReply):
        return reply
    if reply.is_error or reply.is_redirect:
        return ErpReply(ok=False, error=_rejection(reply))
    data = _payload(reply).get("data")
    appointment_id = data.get("appointmentId") if isinstance(data, dict) else None
    if not isinstance(appointment_id, str) or not appointment_id:
        return ErpReply(ok=False, error="El ERP respondió algo inesperado al recibir la cita")
    return ErpReply(ok=True, appointment_id=appointment_id)
