"""Consumer contract: only the operations used outside this capability."""

from app.modules.platform.settings_service import (
    get_effective,
    get_effective_many,
    update_settings,
)

__all__ = ['get_effective', 'get_effective_many', 'update_settings']
