"""Lecturas del plano de control para el panel de plataforma.

Las escrituras (alta, dominios, suspensión) viven en `tenancy/provisioning.py`,
que es donde está la saga completa; acá solo el inventario que el panel muestra.
"""

from __future__ import annotations

from sqlalchemy import select

from db.models import Organization, OrganizationDomain, TenantSchemaVersion
from db.session import control_session
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
