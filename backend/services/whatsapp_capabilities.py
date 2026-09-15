import httpx

from services import meta_service
from services.evolution_service import EvolutionApiError, get_instance_capabilities
from services.whatsapp_rules import default_interactive_footer, interactive_limits_payload

MISSING_META_CONFIG_REASON = (
    "Falta configurar el token, el phone number id y el WABA id de Meta Cloud "
    "API en Configuración."
)
EDIT_DELETE_UNSUPPORTED_DETAIL = "El canal de WhatsApp conectado no permite editar ni eliminar mensajes enviados"
HISTORY_UNSUPPORTED_DETAIL = "El canal de WhatsApp conectado no permite traer el historial anterior"


async def _history_available() -> bool:
    try:
        return bool((await get_instance_capabilities())["history_available"])
    except (EvolutionApiError, httpx.HTTPError):
        return False


async def get_whatsapp_capabilities() -> dict:
    configured = await meta_service.is_configured()
    return {
        "integration": "WHATSAPP-BUSINESS" if configured else None,
        "official_sending_supported": configured,
        "history_available": await _history_available(),
        "edit_delete_supported": False,
        "reason": None if configured else MISSING_META_CONFIG_REASON,
        "interactive_limits": interactive_limits_payload(),
        "interactive_default_footer": await default_interactive_footer(),
    }
