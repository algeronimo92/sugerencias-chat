"""Cuándo encoló una automatización cada mensaje.

Para poder poner un tope de mensajes automáticos por cliente al día hay que
saber cuándo se mandó cada uno. ``updated_at`` no sirve: cambia con cada
acuse de WhatsApp.

Las filas que ya existen (las que rellenó ``scripts.reconcile_delivery``)
toman la fecha de su ejecución, no la de hoy: si no, el día del despliegue
todos los clientes figurarían con su historial entero recibido «recién».

Plano tenant: corre en cada schema. ``migrate.py`` también recorre public,
donde la tabla no existe: ahí no hay nada que cambiar.

Revision ID: e2a9c7d41f58
Revises: d6f1b3a85c27
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "e2a9c7d41f58"
down_revision: Union[str, None] = "d6f1b3a85c27"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


TABLE = "automation_execution_messages"


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None


def upgrade() -> None:
    if not _table_exists(op.get_bind(), TABLE):
        return
    op.add_column(TABLE, sa.Column("created_at", sa.DateTime(timezone=True), nullable=True))
    op.execute(
        f"UPDATE {TABLE} AS m SET created_at = e.created_at "
        "FROM automation_executions AS e WHERE e.id = m.execution_id"
    )
    op.alter_column(TABLE, "created_at", nullable=False, server_default=sa.func.now())


def downgrade() -> None:
    if not _table_exists(op.get_bind(), TABLE):
        return
    op.drop_column(TABLE, "created_at")
