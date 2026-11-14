"""Los clics de anuncio se borran con el lead.

Revision ID: a3d7e9b1c5f2
Revises: f2a9c6d14e83

`wsp_ad.lead_id` era ON DELETE SET NULL: al borrar un lead la fila quedaba
entera, con su teléfono, nombre, email y el identificador del clic del
anuncio. La política de datos promete que todo eso se elimina con el lead, y
las condiciones de la plataforma de Meta exigen borrarlo cuando la persona lo
pide. Pasa a CASCADE, igual que el resto de lo que cuelga del lead.

No toca filas: las que ya quedaron sin lead por un borrado anterior no se
distinguen de las que n8n guardó antes de que el lead existiera.

Plano tenant: corre en cada schema, también en `public`, donde producción
puede no tener `wsp_ad`. La FK se busca por lo que hace y no por su nombre:
en los negocios que vienen de antes de Alembic la tabla la creó n8n.
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "a3d7e9b1c5f2"
down_revision: Union[str, None] = "f2a9c6d14e83"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

TABLE = "wsp_ad"
# El nombre que le pone Postgres a la FK sin nombre de f32cf61128a0: una base
# migrada y una recién creada quedan iguales.
FK_NAME = "wsp_ad_lead_id_fkey"

_LEAD_FKS = """
SELECT c.conname
FROM pg_constraint c
JOIN pg_class t ON t.oid = c.conrelid
JOIN pg_namespace n ON n.oid = t.relnamespace
JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
WHERE c.contype = 'f'
  AND n.nspname = current_schema()
  AND t.relname = :table
  AND array_length(c.conkey, 1) = 1
  AND a.attname = 'lead_id'
"""


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None


def _replace_lead_fk(ondelete: str) -> None:
    bind = op.get_bind()
    if not _table_exists(bind, TABLE) or not _table_exists(bind, "leads"):
        return
    for name in bind.execute(sa.text(_LEAD_FKS), {"table": TABLE}).scalars().all():
        op.drop_constraint(name, TABLE, type_="foreignkey")
    op.create_foreign_key(FK_NAME, TABLE, "leads", ["lead_id"], ["id"], ondelete=ondelete)


def upgrade() -> None:
    _replace_lead_fk("CASCADE")


def downgrade() -> None:
    _replace_lead_fk("SET NULL")
