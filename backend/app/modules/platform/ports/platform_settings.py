"""Consumer contract: only the operations used outside this capability."""

from app.modules.platform.platform_settings import (
    platform_setting,
    platform_settings_many,
)

__all__ = ['platform_setting', 'platform_settings_many']
