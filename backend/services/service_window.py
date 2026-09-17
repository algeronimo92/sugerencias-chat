"""La ventana de atención de 24 h de WhatsApp, en un solo lugar.

Meta solo deja mandar mensajes libres dentro de las 24 h posteriores al último
mensaje del cliente; pasado ese plazo únicamente una plantilla oficial aprobada
puede reabrir la conversación.

La regla la consultan tres caminos que antes la resolvían cada uno por su
cuenta: las automatizaciones, los mensajes programados y el envío manual del
vendedor desde el chat. Vivía dentro de `services/automations/`, que es la
razón por la que los otros dos no podían reusarla.
"""

from services.db_service import get_customer_service_window

SERVICE_WINDOW_CLOSED_ERROR = "No se envió WhatsApp porque la ventana de 24 horas está cerrada"
SERVICE_WINDOW_ERROR_CODE = "service_window_closed"

# Lo que ve una persona, con la salida: el error de arriba es el que queda
# registrado en la ejecución y el que el frontend mapea al botón de autorizar.
SERVICE_WINDOW_CLOSED_DETAIL = (
    "No se envió porque la ventana de atención de 24 horas está cerrada. "
    "Espera un nuevo mensaje del cliente o usa una plantilla oficial."
)


def window_is_open(window: dict | None) -> bool:
    """Decide sobre una ventana ya consultada.

    Separado de la consulta porque las automatizaciones reciben la ventana por
    inyección (`AutomationDeps.get_customer_service_window`) y no pueden ir a
    buscarla ellas mismas.
    """
    return bool(window and window["is_open"])


async def service_window_is_open(chat_id: str) -> bool:
    return window_is_open(await get_customer_service_window(chat_id))
