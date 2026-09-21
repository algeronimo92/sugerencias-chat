from services.settings_service import get_effective_many

# Alias sintético de los leads creados a mano (sin webhook): pertenecen a
# cualquier conexión.
ANY_CONNECTION = "*"


async def active_connection() -> str:
    """Nombre de la conexión de WhatsApp en uso, tal como lo reportan los
    mensajes entrantes (``whatsapp_identities.instance``).

    Se lee de su propia clave para permitir un override manual; si no se
    configura, se deriva sola según el proveedor conectado: el
    ``phone_number_id`` de Meta Cloud API, o si no, el nombre de instancia de
    Evolution (compatibilidad con los alias que ya existían de esa etapa).
    """
    values = await get_effective_many((
        "whatsapp_active_connection",
        "meta_phone_number_id",
        "evolution_instance",
    ))
    return (
        values["whatsapp_active_connection"]
        or values["meta_phone_number_id"]
        or values["evolution_instance"]
    ).strip()


async def connection_scope() -> tuple[str, ...] | None:
    """Conexiones cuyos alias son visibles, o None si no hay ninguna activa
    configurada (ahí no se filtra: no hay forma de saber cuál es)."""
    connection = await active_connection()
    return (connection, ANY_CONNECTION) if connection else None
