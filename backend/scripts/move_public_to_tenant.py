"""Mueve las tablas de negocio de ``public`` al schema de un tenant ya creado.

Es el corte de la §11 del plan de arquitectura: la instalación single-tenant
tiene sus datos en ``public``; el aprovisionador ya dejó el schema del negocio
con las mismas tablas vacías. Mover en vez de copiar conserva datos, índices,
constraints y secuencias sin exportar nada.

Se mueve por ``ALTER TABLE ... SET SCHEMA``, que arrastra índices, constraints y
las secuencias propias de la tabla. Las FK se guardan por OID, así que mover
**todo** el conjunto deja las referencias dentro del schema del tenant; mover
solo algunas dejaría FK cruzadas apuntando a ``public``. Por eso la lista es
completa o nada, y se calcula desde el catálogo en vez de estar escrita a mano.

Uso:
    python -m scripts.move_public_to_tenant --hostname dermicapro.localhost
    python -m scripts.move_public_to_tenant --hostname dermicapro.localhost --apply
"""

from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import select, text

from db.models import Organization, OrganizationDomain
from db.session import close_engine, control_session, get_engine
from tenancy.context import validate_schema_name
from tenancy.resolver import normalize_hostname


# Se quedan en `public`: son del plano de control, comunes a todos los negocios.
# `alembic_version` es la revisión del propio `public` (cada tenant tiene la
# suya dentro de su schema) y `n8n_chat_histories` es de n8n, no de la app.
CONTROL_PLANE_TABLES = frozenset(
    {
        "organizations",
        "organization_domains",
        "whatsapp_connections",
        "tenant_schema_versions",
        "platform_settings",
        "webhook_inbox",
        "alembic_version",
        "n8n_chat_histories",
    }
)

# Señales de que ese schema ya está en uso. No alcanza con "¿hay alguna fila?":
# la propia cadena de migraciones siembra catálogos (categorías de plantillas,
# por ejemplo), así que un tenant recién aprovisionado nunca está del todo
# vacío. Estas tres, en cambio, solo tienen filas si alguien operó el negocio.
ACTIVITY_TABLES = ("users", "leads", "wsp_messages")


async def _schema_for(hostname: str) -> str:
    async with control_session() as session:
        row = (
            await session.execute(
                select(Organization.schema_name)
                .join(
                    OrganizationDomain,
                    OrganizationDomain.organization_id == Organization.id,
                )
                .where(OrganizationDomain.hostname == hostname)
            )
        ).scalar_one_or_none()
    if row is None:
        raise SystemExit(f"No hay ninguna organización registrada para {hostname}")
    return validate_schema_name(row)


async def _business_tables(connection) -> list[str]:
    rows = (
        await connection.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")
        )
    ).scalars().all()
    return [name for name in rows if name not in CONTROL_PLANE_TABLES]


async def _rows_in(connection, schema: str, table: str, preparer) -> int:
    quoted = f"{preparer.quote(schema)}.{preparer.quote(table)}"
    return (await connection.execute(text(f"SELECT count(*) FROM {quoted}"))).scalar_one()


async def _tenant_tables(connection, schema: str) -> set[str]:
    rows = (
        await connection.execute(
            text("SELECT tablename FROM pg_tables WHERE schemaname = :schema"),
            {"schema": schema},
        )
    ).scalars().all()
    return set(rows)


async def _main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hostname", required=True)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="sin este flag solo informa lo que haría",
    )
    args = parser.parse_args()

    try:
        schema = await _schema_for(normalize_hostname(args.hostname))
        engine = get_engine()
        async with engine.begin() as connection:
            preparer = connection.dialect.identifier_preparer
            tables = await _business_tables(connection)
            if not tables:
                print(f"No queda ninguna tabla de negocio en public; {schema} ya está servido.")
                return 0

            existing_in_tenant = await _tenant_tables(connection, schema)
            if not existing_in_tenant:
                raise SystemExit(
                    f"El schema {schema} no existe o está vacío: aprovisionalo primero "
                    "con scripts.provision_tenant."
                )

            # Nunca pisar datos: el schema del tenant tiene que estar recién
            # creado. Si alguien ya operó ahí, este corte destruiría su trabajo.
            ocupadas = [
                table
                for table in ACTIVITY_TABLES
                if table in existing_in_tenant
                and await _rows_in(connection, schema, table, preparer)
            ]
            if ocupadas:
                raise SystemExit(
                    f"El schema {schema} ya está en uso (filas en: {', '.join(ocupadas)}). "
                    "Abortado para no perder datos."
                )

            total = 0
            for table in tables:
                filas = await _rows_in(connection, "public", table, preparer)
                total += filas
                print(f"  {table}: {filas} filas")
                if not args.apply:
                    continue
                quoted_table = preparer.quote(table)
                if table in existing_in_tenant:
                    await connection.execute(
                        text(f"DROP TABLE {preparer.quote(schema)}.{quoted_table} CASCADE")
                    )
                await connection.execute(
                    text(
                        f"ALTER TABLE public.{quoted_table} SET SCHEMA {preparer.quote(schema)}"
                    )
                )

            verbo = "Movidas" if args.apply else "Se moverían"
            print(f"{verbo} {len(tables)} tablas ({total} filas) de public a {schema}.")
            if not args.apply:
                print("Nada se modificó: repetir con --apply.")
        return 0
    finally:
        await close_engine()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(_main()))
