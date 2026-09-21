"""Activa en el plano de control el número por el que ya entran los webhooks.

El Embedded Signup hace esto solo, pero un negocio que se conectó antes de que
existiera el plano de control tiene las credenciales únicamente en el
``app_settings`` de su schema. Sin la fila en ``public.whatsapp_connections``,
`resolve_tenant_by_phone_number_id` no encuentra el tenant y todo evento de Meta
responde 404.

Ejemplo:
    python -m scripts.sync_whatsapp_connection --hostname dermicapro.localhost
"""

from __future__ import annotations

import argparse
import asyncio
import json
from uuid import UUID

from sqlalchemy import select

from db.models import Organization, OrganizationDomain
from db.session import close_engine, control_session
from services.settings_service import get_effective_many
from tenancy.context import TenantContext, tenant_context
from tenancy.provisioning import sync_whatsapp_connection
from tenancy.resolver import normalize_hostname


async def _context_for(hostname: str) -> TenantContext:
    async with control_session() as session:
        row = (
            await session.execute(
                select(Organization, OrganizationDomain)
                .join(
                    OrganizationDomain,
                    OrganizationDomain.organization_id == Organization.id,
                )
                .where(OrganizationDomain.hostname == hostname)
            )
        ).one_or_none()
    if row is None:
        raise SystemExit(f"No hay ninguna organización registrada para {hostname}")
    organization, domain = row
    return TenantContext(
        UUID(str(organization.id)), organization.schema_name, domain.hostname
    )


async def _main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hostname", required=True)
    parser.add_argument(
        "--phone-number-id",
        help="por defecto se lee del app_settings del negocio",
    )
    parser.add_argument("--waba-id", help="por defecto se lee del app_settings del negocio")
    parser.add_argument("--provider", default="meta", choices=("meta", "evolution"))
    args = parser.parse_args()

    try:
        context = await _context_for(normalize_hostname(args.hostname))
        phone_number_id = args.phone_number_id
        waba_id = args.waba_id
        if not phone_number_id or not waba_id:
            with tenant_context(context):
                stored = await get_effective_many(
                    ("meta_phone_number_id", "meta_waba_id")
                )
            phone_number_id = phone_number_id or stored["meta_phone_number_id"]
            waba_id = waba_id or stored["meta_waba_id"]
        if not phone_number_id:
            raise SystemExit(
                "El negocio no tiene meta_phone_number_id configurado; pasalo con "
                "--phone-number-id"
            )

        await sync_whatsapp_connection(
            context.organization_id,
            phone_number_id=phone_number_id,
            waba_id=waba_id or None,
            provider=args.provider,
        )
        print(
            json.dumps(
                {
                    "organization_id": str(context.organization_id),
                    "hostname": context.hostname,
                    "phone_number_id": phone_number_id,
                    "waba_id": waba_id or None,
                    "status": "active",
                }
            )
        )
        return 0
    finally:
        await close_engine()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
