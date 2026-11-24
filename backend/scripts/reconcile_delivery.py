"""Deja la entrega de las automatizaciones igual a lo que de verdad pasó.

Cada ejecución lleva anotado qué fue de los mensajes que mandó (salieron, se
entregaron, fallaron). Esa cuenta se alimenta de avisos, así que puede
quedar atrasada si uno se pierde, y las ejecuciones anteriores a que
existiera no tienen nada. Este comando recorre las ejecuciones de un negocio,
consulta el estado real de cada mensaje y corrige las diferencias.

Sirve para tres cosas: rellenar lo antiguo, reparar un aviso perdido y
comprobar en cualquier momento que la cuenta coincide con la realidad (si no
informa correcciones, coincide).

Por defecto solo simula: escribe únicamente con ``--apply``.

Uso desde el contenedor del backend::

    python -m scripts.reconcile_delivery --hostname dermicapro.cliniventas.com
    python -m scripts.reconcile_delivery --hostname dermicapro.cliniventas.com --apply
"""

import argparse
import asyncio
from uuid import UUID

from sqlalchemy import select

from app.db.models.control import Organization, OrganizationDomain
from app.composition import configure
from app.db.session import close_engine, control_session
from app.modules.automations.application.delivery import reconcile_delivery
from app.tenancy.context import TenantContext, tenant_context
from app.tenancy.resolver import normalize_hostname


async def _context_for(hostname: str) -> TenantContext:
    async with control_session() as session:
        row = (await session.execute(
            select(Organization, OrganizationDomain)
            .join(OrganizationDomain, OrganizationDomain.organization_id == Organization.id)
            .where(OrganizationDomain.hostname == hostname)
        )).one_or_none()
    if row is None:
        raise SystemExit(f"No hay ninguna organización registrada para {hostname}")
    organization, domain = row
    return TenantContext(UUID(str(organization.id)), organization.schema_name, domain.hostname)


async def _main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--hostname", required=True)
    parser.add_argument("--apply", action="store_true", help="escribe las correcciones (sin esto solo simula)")
    args = parser.parse_args()
    # Sin esto los puertos no tienen adaptadores: un script no pasa por el
    # arranque de la API, que es quien los registra.
    configure()
    try:
        context = await _context_for(normalize_hostname(args.hostname))
        with tenant_context(context):
            report = await reconcile_delivery(apply=args.apply)
    finally:
        await close_engine()

    print(f"Negocio: {context.hostname}")
    print(f"Ejecuciones revisadas: {report.executions} ({report.with_messages} con mensajes)")
    print(f"Mensajes que ya no se pueden ubicar: {report.untraceable}")
    if not report.corrected:
        print("La cuenta de entrega coincide con la realidad: nada que corregir.")
        return 0
    verb = "Corregidas" if args.apply else "A corregir"
    print(f"{verb}: {sum(report.corrected.values())} mensajes en {report.changed_executions} ejecuciones")
    for transition, count in report.corrected.most_common():
        print(f"  {transition}: {count}")
    if not args.apply:
        print("Simulación: no se escribió nada. Repite con --apply para aplicarlo.")
    return 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
