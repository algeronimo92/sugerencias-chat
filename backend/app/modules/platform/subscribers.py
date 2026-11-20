"""Avisos posteriores al guardado de la configuración del negocio."""

from app.realtime.ws_manager import manager


async def lead_visibility_changed() -> None:
    # Sin ids ni contenido: también lo recibe quien acaba de perder acceso.
    await manager.broadcast({"type": "lead_visibility_changed"})
