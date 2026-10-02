"""Consumer contract: only the operations used outside this capability."""

from app.modules.catalogs.template_delivery import (
    MEDIA_CAPTION_MAX_LENGTH,
    build_internal_template_items,
)

__all__ = ['MEDIA_CAPTION_MAX_LENGTH', 'build_internal_template_items']
