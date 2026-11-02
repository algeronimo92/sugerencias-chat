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

Si el negocio se dio de alta desde el panel con un primer admin, el schema
destino ya tiene ese usuario y el corte se niega a seguir. Cuando ese admin
es el mismo que llega desde ``public`` (mismo correo), se puede descartar el
sembrado de forma explícita:
    python -m scripts.move_public_to_tenant --hostname dermicapro.localhost \
        --discard-seeded-admin --apply

Los archivos multimedia no viven en PostgreSQL: van aparte con
``scripts.copy_legacy_media_to_tenant``.
"""

from __future__ import annotations

import argparse
import asyncio

from sqlalchemy import select, text

from app.db.base import Base
# Importar el módulo registra en Base.metadata todos los modelos de control.
from app.db.models.control import Organization, OrganizationDomain
from app.db.session import close_engine, control_session, get_engine
from app.tenancy.context import validate_schema_name
from app.tenancy.resolver import normalize_hostname


def _control_plane_tables() -> frozenset[str]:
    """Tablas que se quedan en `public`: el plano de control, común a todos.

    Salen de los modelos que declaran ``schema: public`` en vez de una lista a
    mano. La lista anterior se quedó atrás cuando aparecieron el panel y la
    marca: el corte se habría llevado ``platform_users`` al schema del primer
    negocio y nadie habría podido volver a entrar al panel.

    `alembic_version` es la revisión del propio `public` (cada tenant tiene la
    suya dentro de su schema) y `n8n_chat_histories` es de n8n, no de la app.
    """
    modeladas = {
        table.name
        for table in Base.metadata.tables.values()
        if table.schema == "public"
    }
    return frozenset(modeladas | {"alembic_version", "n8n_chat_histories"})


CONTROL_PLANE_TABLES = _control_plane_tables()

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


async def _seeded_admin_arrives_from_public(connection, schema: str, preparer) -> bool:
    """El único usuario del tenant es un admin que también existe en `public`.

    Es lo que deja el alta desde el panel: el aprovisionador siembra el primer
    admin con el correo del dueño, que es el mismo admin que ya opera el
    negocio desde `public`. Descartarlo no pierde a nadie porque llega con la
    tabla movida. Cualquier otra cosa (más usuarios, otro correo, otro rol)
    sigue siendo un schema en uso.
    """
    users = f"{preparer.quote(schema)}.{preparer.quote('users')}"
    rows = (
        await connection.execute(
            text(
                f"SELECT t.role, EXISTS ("
                f"  SELECT 1 FROM public.users p WHERE lower(p.email) = lower(t.email)"
                f") AS en_public FROM {users} t"
            )
        )
    ).all()
    return len(rows) == 1 and rows[0].role == "admin" and rows[0].en_public


async def _main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hostname", required=True)
    parser.add_argument(
        "--apply",
        action="store_true",
        help="sin este flag solo informa lo que haría",
    )
    parser.add_argument(
        "--discard-seeded-admin",
        action="store_true",
        help=(
            "acepta un destino cuyo único dato es el admin sembrado por el alta, "
            "si ese correo también está en public.users"
        ),
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
            if (
                ocupadas == ["users"]
                and args.discard_seeded_admin
                and await _seeded_admin_arrives_from_public(connection, schema, preparer)
            ):
                # La tabla del tenant se reemplaza por la de public más abajo
                # (DROP + SET SCHEMA): el sembrado desaparece con ella.
                print("  Se descarta el admin sembrado: el mismo correo llega desde public.users")
                ocupadas = []
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
