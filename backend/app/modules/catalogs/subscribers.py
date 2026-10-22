"""Avisos de los catálogos, después del commit."""

from __future__ import annotations

from app.core.events import Phase, subscribe
from app.modules.catalogs.events import TemplatesChanged
from app.realtime.ws_manager import manager


@subscribe(TemplatesChanged, phase=Phase.AFTER_COMMIT)
async def announce_templates_changed(event: TemplatesChanged) -> None:
    if event.template_ids:
        await manager.broadcast({
            "type": "templates_updated",
            "template_ids": list(event.template_ids),
            "source": event.source,
        })
    else:
        await manager.broadcast({"type": "templates_updated"})
    if event.media_library_affected:
        await manager.broadcast({"type": "media_library_updated"})
