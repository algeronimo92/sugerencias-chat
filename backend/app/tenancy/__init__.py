"""Primitivas para resolver y propagar el tenant de una operación."""

from app.tenancy.context import (
    TenantContext,
    get_current_tenant,
    reset_current_tenant,
    set_current_tenant,
    tenant_context,
    validate_schema_name,
)

_RESOLVER_EXPORTS = {
    "list_active_tenants",
    "normalize_hostname",
    "resolve_tenant_by_hostname",
    "resolve_tenant_by_organization_id",
    "resolve_tenant_by_phone_number_id",
    "resolve_tenant_by_waba_id",
}
_PROVISIONING_EXPORTS = {
    "TenantProvisioningError",
    "provision_tenant",
    "tenant_migration_head",
}


def __getattr__(name: str):
    # Lazy para que app.db.session pueda importar app.tenancy.context sin formar el
    # ciclo app.db.session -> app.tenancy.__init__ -> resolver -> app.db.session.
    if name in _RESOLVER_EXPORTS:
        from app.tenancy import resolver

        return getattr(resolver, name)
    if name in _PROVISIONING_EXPORTS:
        from app.tenancy import provisioning

        return getattr(provisioning, name)
    raise AttributeError(name)

__all__ = [
    "TenantContext",
    "get_current_tenant",
    "reset_current_tenant",
    "set_current_tenant",
    "tenant_context",
    "validate_schema_name",
    "list_active_tenants",
    "normalize_hostname",
    "resolve_tenant_by_hostname",
    "resolve_tenant_by_organization_id",
    "resolve_tenant_by_phone_number_id",
    "resolve_tenant_by_waba_id",
    "TenantProvisioningError",
    "provision_tenant",
    "tenant_migration_head",
]
