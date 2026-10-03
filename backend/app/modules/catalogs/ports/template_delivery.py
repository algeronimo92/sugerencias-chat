"""Consumer contract: only the operations used outside this capability."""

from app.modules.catalogs.template_delivery import (
    MEDIA_CAPTION_MAX_LENGTH,
    build_internal_template_items,
)
from app.modules.catalogs.template_queries import (
    fetch_template_for_delivery,
)

__all__ = ['MEDIA_CAPTION_MAX_LENGTH', 'build_internal_template_items', 'fetch_template_for_delivery']
