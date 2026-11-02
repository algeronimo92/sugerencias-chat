"""Avisos de la librería de medios, después del commit."""

from __future__ import annotations

from app.core.events import Phase, subscribe
from app.modules.media.events import MediaLibraryChanged
from app.realtime.ws_manager import manager


@subscribe(MediaLibraryChanged, phase=Phase.AFTER_COMMIT)
async def announce_media_library_changed(event: MediaLibraryChanged) -> None:
    await manager.broadcast({"type": "media_library_updated"})
    if event.templates_affected:
        await manager.broadcast({"type": "templates_updated"})
