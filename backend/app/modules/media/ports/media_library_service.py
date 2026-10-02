"""Consumer contract: only the operations used outside this capability."""

from app.modules.media.media_library_service import (
    create_media_asset,
    delete_media_asset,
    get_media_asset,
    set_media_asset_ai_description,
)

__all__ = ['create_media_asset', 'delete_media_asset', 'get_media_asset', 'set_media_asset_ai_description']
