"""Avisos posteriores a un cambio de la matriz de permisos."""

from app.realtime.ws_manager import manager


async def role_permissions_changed() -> None:
    # Quitar o dar ``leads.view_all`` cambia qué leads ve cada vendedor: las
    # listas abiertas se vuelven a pedir. Sin ids ni contenido.
    await manager.broadcast({"type": "lead_visibility_changed"})
