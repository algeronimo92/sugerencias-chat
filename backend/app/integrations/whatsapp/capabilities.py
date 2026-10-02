"""Qué sabe hacer el canal de WhatsApp conectado.

Todo sale del canal y del contrato de Meta: este módulo no nombra a un
proveedor, porque existe justamente para que el resto del sistema no tenga que
saber cuál está conectado.
"""

from app.integrations.meta.outbound import CAPABILITY_SETTINGS, published_flows
from app.modules.platform.ports.settings_service import (get_effective_many)
from app.integrations.whatsapp.channels import current_channel
from app.integrations.whatsapp.rules import default_interactive_footer, interactive_limits_payload


async def get_whatsapp_capabilities() -> dict:
    channel = current_channel()
    availability = await channel.status.availability()
    settings = await get_effective_many(tuple(CAPABILITY_SETTINGS.values()))
    catalog_id = settings["meta_catalog_id"].strip()
    flows = published_flows(settings["meta_published_flow_ids"])
    return {
        "integration": availability.integration,
        "official_sending_supported": availability.configured,
        "reason": availability.reason,
        "interactive_limits": interactive_limits_payload(),
        "interactive_default_footer": await default_interactive_footer(),
        # Salidas condicionadas por la cuenta (contracts/meta_messages.json).
        "catalog_enabled": bool(catalog_id),
        "flows_enabled": bool(flows),
        "call_permission_enabled": settings["meta_call_permission_enabled"] == "true",
        "catalog_id": catalog_id or None,
        "published_flows": flows,
    }
