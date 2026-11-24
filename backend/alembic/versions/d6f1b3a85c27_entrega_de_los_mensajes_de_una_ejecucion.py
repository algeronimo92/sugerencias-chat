"""Qué pasó con los mensajes que mandó cada ejecución.

Una ejecución queda «completada» cuando encola sus mensajes, no cuando
llegan: en DermicaPro había 22 completadas con mensajes que nunca salieron.

- ``automation_execution_messages``: un mensaje encolado por una ejecución y
  lo último que se supo de él. Es el puente entre los avisos de envío, que
  traen el id del mensaje, y la ejecución que lo mandó.
- ``automation_executions.delivery_state``: el resumen, para filtrar y contar
  sin agrupar. NULL en las que no mandaron mensajes y en todas las anteriores
  a esta revisión, hasta que ``scripts.reconcile_delivery`` las rellene.

Columna opcional y tabla nueva: no reescribe ``automation_executions``.

Plano tenant: corre en cada schema. ``migrate.py`` también recorre public,
donde ``automation_executions`` no existe: ahí no hay nada que cambiar.

Revision ID: d6f1b3a85c27
Revises: c4e8a1b72d95
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d6f1b3a85c27"
down_revision: Union[str, None] = "c4e8a1b72d95"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


EXECUTIONS = "automation_executions"
MESSAGES = "automation_execution_messages"


def _table_exists(bind, table: str) -> bool:
    """En el schema activo (el del negocio que se está migrando)."""
    return bind.execute(sa.text(
        "SELECT 1 FROM information_schema.tables "
        "WHERE table_schema = current_schema() AND table_name = :table"
    ), {"table": table}).first() is not None


def upgrade() -> None:
    if not _table_exists(op.get_bind(), EXECUTIONS):
        return
    op.add_column(EXECUTIONS, sa.Column("delivery_state", sa.Text(), nullable=True))
    op.create_check_constraint(
        "ck_automation_executions_delivery_state", EXECUTIONS,
        "delivery_state IN ('pending', 'delivered', 'failed')",
    )
    op.create_index(
        "idx_automation_executions_undelivered", EXECUTIONS,
        ["delivery_state", sa.text("created_at DESC")],
        postgresql_where=sa.text("delivery_state IN ('pending', 'failed')"),
    )
    op.create_table(
        MESSAGES,
        sa.Column("message_id", sa.BigInteger(), autoincrement=False, nullable=False),
        sa.Column("execution_id", sa.BigInteger(), nullable=False),
        sa.Column("state", sa.Text(), server_default="pending", nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.CheckConstraint(
            "state IN ('pending', 'sent', 'delivered', 'read', 'failed')",
            name="ck_automation_execution_messages_state",
        ),
        sa.ForeignKeyConstraint(["execution_id"], [f"{EXECUTIONS}.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("message_id"),
    )
    op.create_index("idx_automation_execution_messages_execution", MESSAGES, ["execution_id"])


def downgrade() -> None:
    if not _table_exists(op.get_bind(), EXECUTIONS):
        return
    op.drop_table(MESSAGES)
    op.drop_index("idx_automation_executions_undelivered", table_name=EXECUTIONS)
    op.drop_constraint("ck_automation_executions_delivery_state", EXECUTIONS, type_="check")
    op.drop_column(EXECUTIONS, "delivery_state")
