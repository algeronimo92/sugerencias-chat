"""Lo que el tiempo real hace ante eventos de la plataforma."""

from __future__ import annotations

from app.core.events import Phase, subscribe
from app.realtime.ws_manager import manager
from app.tenancy.events import OrganizationSuspended


@subscribe(OrganizationSuspended, phase=Phase.AFTER_COMMIT)
async def disconnect_suspended_organization(event: OrganizationSuspended) -> None:
    """Un WebSocket ya aceptado no vuelve a pasar por el middleware: hay que
    cerrarlo a mano para que la suspensión alcance a lo ya conectado."""
    await manager.disconnect_organization(event.organization_id)
