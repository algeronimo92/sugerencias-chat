"""Checklist de primeros pasos del negocio.

Cada paso se calcula de los datos reales, no de un "lo marqué hecho": si el
admin desconecta Google o borra el último servicio con precio, el paso vuelve
a quedar pendiente. Lo único que se guarda es si el admin cerró la tarjeta.
"""

from __future__ import annotations

from app.modules.auth.public import team_summary
from app.modules.catalogs.public import onboarding_catalog_status
from app.modules.platform.settings_service import (
    WHATSAPP_CREDENTIAL_KEYS,
    WHATSAPP_DISCONNECTED_KEY,
    get_effective_many,
    update_settings,
)
from app.modules.platform.starter_pack import STARTER_SHORTCUTS

DISMISSED_KEY = "onboarding_checklist_dismissed"

# Lo mismo que mira el estado de WhatsApp: las tres credenciales y que Meta
# no haya desvinculado el número. Se lee acá directo para no sumar otro
# consumidor del cliente de Meta (test_layering.META_ALLOWED solo se achica).


async def onboarding_status() -> dict:
    values = await get_effective_many(
        (*WHATSAPP_CREDENTIAL_KEYS, WHATSAPP_DISCONNECTED_KEY, "google_calendar_refresh_token", DISMISSED_KEY)
    )
    whatsapp_connected = (
        all(values[key] for key in WHATSAPP_CREDENTIAL_KEYS) and not values[WHATSAPP_DISCONNECTED_KEY]
    )
    team = await team_summary()
    catalog = await onboarding_catalog_status(STARTER_SHORTCUTS)
    steps = [
        {"key": "whatsapp", "done": whatsapp_connected, "optional": False},
        # El admin que abrió la cuenta no cuenta: una invitación pendiente sí.
        {"key": "team", "done": team["users"] > 1, "optional": False},
        {"key": "services", "done": catalog["priced_services"] > 0, "optional": False},
        {"key": "google_calendar", "done": bool(values["google_calendar_refresh_token"]), "optional": False},
        {"key": "templates", "done": catalog["templates_customized"], "optional": True},
    ]
    required = [step for step in steps if not step["optional"]]
    return {
        "steps": steps,
        "completed": sum(1 for step in required if step["done"]),
        "total": len(required),
        "all_done": all(step["done"] for step in required),
        "dismissed": values[DISMISSED_KEY] == "true",
    }


async def dismiss_onboarding() -> dict:
    await update_settings({DISMISSED_KEY: "true"})
    return await onboarding_status()


async def restore_onboarding() -> dict:
    """Vuelve a mostrar la tarjeta. Cerrarla no tenía vuelta atrás y el admin
    que la cerraba por error se quedaba sin el atajo a los pasos pendientes."""
    await update_settings({DISMISSED_KEY: "false"})
    return await onboarding_status()
