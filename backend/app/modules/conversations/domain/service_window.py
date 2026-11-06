"""La ventana de atención de 24 h de WhatsApp, en un solo lugar.

Meta solo deja mandar mensajes libres dentro de las 24 h posteriores al último
mensaje del cliente; pasado ese plazo únicamente una plantilla oficial aprobada
puede reabrir la conversación. La consultan tres caminos: las automatizaciones,
los mensajes programados y el envío manual del vendedor desde el chat.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

CUSTOMER_SERVICE_WINDOW = timedelta(hours=24)

SERVICE_WINDOW_CLOSED_ERROR = "No se envió WhatsApp porque la ventana de 24 horas está cerrada"
SERVICE_WINDOW_ERROR_CODE = "service_window_closed"

# Lo que ve una persona, con la salida: el error de arriba es el que queda
# registrado en la ejecución y el que el frontend mapea al botón de autorizar.
SERVICE_WINDOW_CLOSED_DETAIL = (
    "No se envió porque la ventana de atención de 24 horas está cerrada. "
    "Espera un nuevo mensaje del cliente o usa una plantilla oficial."
)


def window_is_open(window: dict | None) -> bool:
    """Decide sobre una ventana ya consultada (las automatizaciones la reciben
    por inyección y no la buscan ellas mismas)."""
    return bool(window and window["is_open"])


# --- Ventana gratis por anuncio (Free Entry Point) ------------------------
#
# Si el cliente escribió desde un anuncio Click-to-WhatsApp en el celular y el
# negocio responde dentro de las 24 h, Meta abre una ventana de hasta 7 días
# (72 h hasta el 2026-09-28) en la que no cobra marketing, utility,
# authentication ni service. NO extiende la ventana de atención: pasadas las
# 24 h del último mensaje del cliente, Meta sigue rechazando el texto libre
# (131047) y solo acepta plantillas, que en esta ventana salen gratis.
#
# La duración exacta no se calcula acá: Meta la informa en el webhook de
# estado ``sent`` de cada mensaje enviado dentro de esa ventana, en
# ``conversation.expiration_timestamp`` con ``origin.type ==
# "referral_conversion"`` (desde v24.0 el objeto ``conversation`` solo viaja
# en ese caso).
FREE_ENTRY_POINT_ORIGIN = "referral_conversion"
# Plazo para responder a un cliente que llegó por anuncio y abrir la ventana.
AD_REPLY_WINDOW = CUSTOMER_SERVICE_WINDOW


def free_entry_point_expiry(status: dict) -> datetime | None:
    """Vencimiento de la ventana gratis por anuncio que trae un ``statuses[]``
    de Meta, o None si el mensaje no se mandó dentro de una."""
    conversation = status.get("conversation")
    if not isinstance(conversation, dict):
        return None
    origin = conversation.get("origin")
    if not isinstance(origin, dict) or origin.get("type") != FREE_ENTRY_POINT_ORIGIN:
        return None
    raw = conversation.get("expiration_timestamp")
    try:
        seconds = int(raw)
    except (TypeError, ValueError):
        return None
    if seconds <= 0:
        return None
    return datetime.fromtimestamp(seconds, tz=timezone.utc)
