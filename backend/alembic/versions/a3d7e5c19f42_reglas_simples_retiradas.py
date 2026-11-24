"""Las reglas simples se retiran: lo que quede de ellas se cierra.

El backend ya no distingue reglas simples de flujos visuales ni lee
``builder_mode``, ``actions`` o ``delay_minutes``. Antes de eso hay que dejar
la tabla en un estado donde no leerlas sea correcto:

- Una regla simple que quedara viva pasaría por flujo sin bloques y fallaría
  en cada disparo. Se archiva (``deleted_at``) y sus ejecuciones pendientes
  se cancelan con el motivo. En producción no había ninguna al escribir esto.
- ``builder_mode`` pasa a valer ``visual`` por omisión, porque el backend deja
  de escribirlo. Durante el cambio azul-verde la versión anterior sigue
  leyéndolo, y con el valor viejo (``simple``) no vería los flujos nuevos.

Las columnas se borran en la revisión siguiente, que va en otro despliegue:
si se borraran acá, la versión anterior fallaría en cada consulta mientras
dura el cambio.

Plano tenant: corre en cada schema. ``migrate.py`` también recorre public,
donde la tabla no existe: ahí no hay nada que cambiar.

Revision ID: a3d7e5c19f42
Revises: e2a9c7d41f58
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "a3d7e5c19f42"
down_revision: Union[str, None] = "e2a9c7d41f58"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "automation_rules"


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None


def upgrade() -> None:
    if not _table_exists(op.get_bind(), TABLE):
        return
    op.execute(
        "UPDATE automation_executions SET status = 'cancelled', finished_at = now(), "
        "error = 'Las reglas simples se retiraron. Crea un flujo que la reemplace.' "
        "WHERE status IN ('scheduled', 'running', 'paused') "
        f"AND rule_id IN (SELECT id FROM {TABLE} WHERE builder_mode <> 'visual')"
    )
    op.execute(
        f"UPDATE {TABLE} SET is_active = false, deleted_at = COALESCE(deleted_at, now()), updated_at = now() "
        "WHERE builder_mode <> 'visual' AND (deleted_at IS NULL OR is_active)"
    )
    op.alter_column(TABLE, "builder_mode", server_default="visual")


def downgrade() -> None:
    if not _table_exists(op.get_bind(), TABLE):
        return
    # Las reglas archivadas no se reviven: no se sabe cuáles estaban activas.
    op.alter_column(TABLE, "builder_mode", server_default="simple")
