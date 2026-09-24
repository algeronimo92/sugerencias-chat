"""Qué sabe hacer el canal de WhatsApp conectado.

Todo sale del canal y del contrato de Meta: este módulo no nombra a un
proveedor, porque existe justamente para que el resto del sistema no tenga que
saber cuál está conectado.
"""

from services.meta_outbound import CAPABILITY_SETTINGS
from services.settings_service import get_effective_many
from services.whatsapp_channels import current_channel
from services.whatsapp_rules import default_interactive_footer, interactive_limits_payload


async def get_whatsapp_capabilities() -> dict:
    channel = current_channel()
    availability = await channel.status.availability()
    settings = await get_effective_many(tuple(CAPABILITY_SETTINGS.values()))
    return {
        "integration": availability.integration,
        "official_sending_supported": availability.configured,
        "reason": availability.reason,
        "interactive_limits": interactive_limits_payload(),
        "interactive_default_footer": await default_interactive_footer(),
        # Salidas condicionadas por la cuenta (contracts/meta_messages.json).
        "catalog_enabled": bool(settings["meta_catalog_id"].strip()),
        "flows_enabled": bool(settings["meta_published_flow_ids"].strip()),
        "call_permission_enabled": settings["meta_call_permission_enabled"] == "true",
    }
