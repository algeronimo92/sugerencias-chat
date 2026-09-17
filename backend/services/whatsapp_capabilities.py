"""Qué sabe hacer el canal de WhatsApp conectado.

Todo sale del canal: este módulo no puede nombrar a un proveedor, porque
existe justamente para que el resto del sistema no tenga que saber cuál está
conectado.
"""

from services.whatsapp_channels import current_channel
from services.whatsapp_rules import default_interactive_footer, interactive_limits_payload

EDIT_DELETE_UNSUPPORTED_DETAIL = "El canal de WhatsApp conectado no permite editar ni eliminar mensajes enviados"
HISTORY_UNSUPPORTED_DETAIL = "El canal de WhatsApp conectado no permite traer el historial anterior"


async def get_whatsapp_capabilities() -> dict:
    channel = current_channel()
    availability = await channel.status.availability()
    return {
        "integration": availability.integration,
        "official_sending_supported": availability.configured,
        "history_available": channel.history is not None and await channel.history.is_available(),
        "edit_delete_supported": channel.editor is not None,
        "reason": availability.reason,
        "interactive_limits": interactive_limits_payload(),
        "interactive_default_footer": await default_interactive_footer(),
    }
