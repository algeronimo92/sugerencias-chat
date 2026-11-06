"""Consumer contract: only the operations used outside this capability."""

from app.modules.platform.email_settings import (
    TenantMailConfig,
    TenantMailOAuth,
    get_tenant_mail_config,
    get_tenant_mail_oauth,
    store_rotated_refresh_token,
)

__all__ = [
    'TenantMailConfig',
    'TenantMailOAuth',
    'get_tenant_mail_config',
    'get_tenant_mail_oauth',
    'store_rotated_refresh_token',
]
