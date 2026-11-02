"""La ventana de atención de 24 h de WhatsApp, en un solo lugar.

Meta solo deja mandar mensajes libres dentro de las 24 h posteriores al último
mensaje del cliente; pasado ese plazo únicamente una plantilla oficial aprobada
puede reabrir la conversación. La consultan tres caminos: las automatizaciones,
los mensajes programados y el envío manual del vendedor desde el chat.
"""

from __future__ import annotations

from datetime import timedelta

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
