"""Lecturas del plano de control para el panel de plataforma.

Las escrituras (alta, dominios, suspensión) viven en `tenancy/provisioning.py`,
que es donde está la saga completa; acá solo el inventario que el panel muestra.
"""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import select

from db.models import Organization, OrganizationDomain, TenantSchemaVersion
from db.session import control_session
from services.ai_access import AIEntitlement, count_usage_this_month, get_entitlement
from services.settings_service import (
    PLATFORM_MANAGED_TENANT_KEYS,
    SETTING_DEFS,
    get_effective_many,
    update_settings,
)
from tenancy.context import TenantContext, tenant_context
from tenancy.provisioning import tenant_migration_head


async def list_organizations() -> dict:
    """Negocios con sus dominios y el estado de su schema."""

    head = tenant_migration_head()
    async with control_session() as session:
        organizations = (
            await session.execute(select(Organization).order_by(Organization.created_at))
        ).scalars().all()
        domains = (await session.execute(select(OrganizationDomain))).scalars().all()
        versions = {
            version.organization_id: version
            for version in (
                await session.execute(select(TenantSchemaVersion))
            ).scalars().all()
        }

        por_negocio: dict[str, list[OrganizationDomain]] = {}
        for domain in domains:
            por_negocio.setdefault(str(domain.organization_id), []).append(domain)

        items = []
        for organization in organizations:
            version = versions.get(str(organization.id))
            items.append(
                {
                    "id": str(organization.id),
                    "name": organization.name,
                    "status": organization.status,
                    "schema_name": organization.schema_name,
                    "storage_prefix": organization.storage_prefix,
                    "ai_enabled": organization.ai_enabled,
                    "ai_monthly_quota": organization.ai_monthly_quota,
                    "created_at": organization.created_at.isoformat()
                    if organization.created_at
                    else None,
                    "revision": version.revision if version else None,
                    "migration_status": version.migration_status if version else None,
                    # Que el panel muestre el desfase evita reactivar a ciegas un
                    # negocio cuyo schema quedó en una revisión vieja.
                    "up_to_date": bool(
                        version
                        and version.revision == head
                        and version.migration_status == "current"
                    ),
                    "domains": [
                        {
                            "id": str(domain.id),
                            "hostname": domain.hostname,
                            "is_primary": domain.is_primary,
                        }
                        for domain in sorted(
                            por_negocio.get(str(organization.id), []),
                            key=lambda d: (not d.is_primary, d.hostname),
                        )
                    ],
                }
            )
    return {"head": head, "items": items}


class OrganizationNotFoundError(Exception):
    pass


async def organization_context(organization_id: UUID) -> TenantContext:
    """Contexto del negocio para que el operador actúe sobre su schema.

    A diferencia de ``resolve_tenant_by_organization_id`` también acepta
    negocios suspendidos: el operador puede dejarlos configurados antes de
    reactivarlos. Un negocio sin schema listo (aprovisionando o fallido) no.
    """

    async with control_session() as session:
        row = (
            await session.execute(
                select(
                    Organization.id,
                    Organization.schema_name,
                    Organization.storage_prefix,
                    OrganizationDomain.hostname,
                )
                .join(OrganizationDomain, OrganizationDomain.organization_id == Organization.id)
                .where(
                    Organization.id == str(organization_id),
                    Organization.status.in_(("active", "suspended")),
                    OrganizationDomain.is_primary.is_(True),
                )
            )
        ).first()
    if row is None:
        raise OrganizationNotFoundError(str(organization_id))
    return TenantContext(UUID(str(row.id)), row.schema_name, row.hostname, row.storage_prefix)


async def organization_ai(organization_id: UUID) -> dict:
    context = await organization_context(organization_id)
    entitlement = await get_entitlement(organization_id)
    with tenant_context(context):
        used = await count_usage_this_month()
    return {
        "enabled": entitlement.enabled,
        "monthly_quota": entitlement.monthly_quota,
        "used_this_month": used,
    }


async def update_organization_ai(organization_id: UUID, entitlement: AIEntitlement) -> dict:
    if entitlement.monthly_quota is not None and entitlement.monthly_quota < 0:
        raise ValueError("La cuota mensual no puede ser negativa")
    async with control_session() as session:
        organization = await session.get(Organization, str(organization_id))
        if organization is None:
            raise OrganizationNotFoundError(str(organization_id))
        organization.ai_enabled = entitlement.enabled
        organization.ai_monthly_quota = entitlement.monthly_quota
    return await organization_ai(organization_id)


_MANAGED_DEFS = [d for d in SETTING_DEFS if d.key in PLATFORM_MANAGED_TENANT_KEYS]


async def organization_integrations(organization_id: UUID) -> list[dict]:
    """Ajustes del negocio que carga el operador (hoy, el workflow de citas)."""

    context = await organization_context(organization_id)
    with tenant_context(context):
        values = await get_effective_many(PLATFORM_MANAGED_TENANT_KEYS)
    return [
        {
            "key": definition.key,
            "label": f"{definition.group_label}: {definition.label}",
            "configured": bool(values[definition.key]),
            "value": values[definition.key],
        }
        for definition in _MANAGED_DEFS
    ]


async def update_organization_integrations(
    organization_id: UUID, values: dict[str, str]
) -> list[dict]:
    unknown = set(values) - set(PLATFORM_MANAGED_TENANT_KEYS)
    if unknown:
        raise ValueError(f"Integración desconocida: {', '.join(sorted(unknown))}")
    context = await organization_context(organization_id)
    with tenant_context(context):
        await update_settings({key: value.strip() for key, value in values.items()})
    return await organization_integrations(organization_id)
