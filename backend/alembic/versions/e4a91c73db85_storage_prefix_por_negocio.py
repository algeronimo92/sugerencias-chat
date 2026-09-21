"""organizations.storage_prefix: carpeta fija del negocio en el almacenamiento
de objetos ("<uuid>-<nombre>"). El nombre está solo para reconocerlo en la
consola de MinIO; la ruta se calcula una vez y no se recalcula al renombrar el
negocio, porque eso dejaría huérfanos sus archivos anteriores.

Revision ID: e4a91c73db85
Revises: c8fdf62268bc
"""

import re
import unicodedata
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import context, op


revision: str = "e4a91c73db85"
down_revision: Union[str, None] = "c8fdf62268bc"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _slugify(value: str) -> str:
    """Copia deliberada de ``tenancy.context._slugify``.

    Una migración no puede importar código de la aplicación: si mañana ese
    slug cambia, esta revisión tiene que seguir produciendo lo que produjo el
    día que se ejecutó, o el backfill dejaría de coincidir con las rutas ya
    creadas en el almacenamiento.
    """
    normalized = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", normalized.lower()).strip("-")[:40].strip("-")


def upgrade() -> None:
    # Columna del plano de control: se instala una sola vez en public, nunca al
    # aprovisionar el schema de un tenant (mismo guard que d2b7c4e91a60).
    if context.config.attributes.get("tenant_schema"):
        return

    op.add_column(
        "organizations",
        sa.Column("storage_prefix", sa.Text(), nullable=True),
        schema="public",
    )
    op.create_unique_constraint(
        "uq_organizations_storage_prefix",
        "organizations",
        ["storage_prefix"],
        schema="public",
    )

    connection = op.get_bind()
    rows = connection.execute(
        sa.text("SELECT id, name FROM public.organizations WHERE storage_prefix IS NULL")
    ).all()
    for organization_id, name in rows:
        slug = _slugify(name or "")
        segment = f"{organization_id}-{slug}" if slug else str(organization_id)
        connection.execute(
            sa.text(
                "UPDATE public.organizations SET storage_prefix = :segment WHERE id = :id"
            ),
            {"segment": segment, "id": organization_id},
        )


def downgrade() -> None:
    if context.config.attributes.get("tenant_schema"):
        return
    op.drop_constraint(
        "uq_organizations_storage_prefix", "organizations", schema="public", type_="unique"
    )
    op.drop_column("organizations", "storage_prefix", schema="public")
