from services.settings_service import get_effective_many

# Alias de los leads creados a mano (sin evento de Meta): pertenecen a
# cualquier número del negocio hasta que llegue el primero.
ANY_CONNECTION = "*"


async def active_connection() -> str:
    """``phone_number_id`` del número de WhatsApp en uso.

    ``whatsapp_active_connection`` permite fijarlo a mano; si no, es el
    ``meta_phone_number_id`` conectado.
    """
    values = await get_effective_many((
        "whatsapp_active_connection",
        "meta_phone_number_id",
    ))
    return (values["whatsapp_active_connection"] or values["meta_phone_number_id"]).strip()


async def connection_scope() -> tuple[str, ...] | None:
    """Números cuyos contactos son visibles, o None si no hay ninguno
    configurado (ahí no se filtra: no hay forma de saber cuál es)."""
    connection = await active_connection()
    return (connection, ANY_CONNECTION) if connection else None
