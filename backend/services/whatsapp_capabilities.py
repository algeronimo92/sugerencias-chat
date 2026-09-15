from services import meta_service
from services.whatsapp_channels import current_channel
from services.whatsapp_rules import default_interactive_footer, interactive_limits_payload

MISSING_META_CONFIG_REASON = (
    "Falta configurar el token, el phone number id y el WABA id de Meta Cloud "
    "API en Configuración."
)
EDIT_DELETE_UNSUPPORTED_DETAIL = "El canal de WhatsApp conectado no permite editar ni eliminar mensajes enviados"
HISTORY_UNSUPPORTED_DETAIL = "El canal de WhatsApp conectado no permite traer el historial anterior"


async def get_whatsapp_capabilities() -> dict:
    channel = current_channel()
    configured = await meta_service.is_configured()
    return {
        "integration": "WHATSAPP-BUSINESS" if configured else None,
        "official_sending_supported": configured,
        "history_available": channel.history is not None and await channel.history.is_available(),
        "edit_delete_supported": channel.editor is not None,
        "reason": None if configured else MISSING_META_CONFIG_REASON,
        "interactive_limits": interactive_limits_payload(),
        "interactive_default_footer": await default_interactive_footer(),
    }
