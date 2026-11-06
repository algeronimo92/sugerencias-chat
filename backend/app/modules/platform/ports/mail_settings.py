"""Consumer contract: only the operations used outside this capability."""

from app.modules.platform.email_settings import (
    TenantMailConfig,
    get_tenant_mail_config,
)

__all__ = ['TenantMailConfig', 'get_tenant_mail_config']
