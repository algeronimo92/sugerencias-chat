"""Consumer contract: only the operations used outside this capability."""

from app.modules.platform.email_settings import (
    TenantMailConfig,
    TenantMailOAuth,
    get_tenant_mail_config,
    get_tenant_mail_oauth,
    store_rotated_refresh_token,
)
from app.modules.platform.platform_email import (
    PlatformMailConfig,
    environment_mail_config,
    get_platform_mail_config,
)

__all__ = [
    'TenantMailConfig',
    'TenantMailOAuth',
    'get_tenant_mail_config',
    'get_tenant_mail_oauth',
    'store_rotated_refresh_token',
    'PlatformMailConfig',
    'environment_mail_config',
    'get_platform_mail_config',
]
