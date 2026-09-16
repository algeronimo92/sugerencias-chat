from services.settings_service import get_effective_many

# Alias sintético de los leads creados a mano (sin webhook): pertenecen a
# cualquier conexión.
ANY_CONNECTION = "*"


async def active_connection() -> str:
    """Nombre de la conexión de WhatsApp en uso, tal como lo reportan los
    mensajes entrantes (``whatsapp_identities.instance``).

    Se lee de su propia clave para no depender de Evolution: mientras no se
    configure, se usa el nombre de instancia de Evolution, que es lo que
    traen los datos existentes.
    """
    values = await get_effective_many(("whatsapp_active_connection", "evolution_instance"))
    return (values["whatsapp_active_connection"] or values["evolution_instance"]).strip()


async def connection_scope() -> tuple[str, ...] | None:
    """Conexiones cuyos alias son visibles, o None si no hay ninguna activa
    configurada (ahí no se filtra: no hay forma de saber cuál es)."""
    connection = await active_connection()
    return (connection, ANY_CONNECTION) if connection else None
