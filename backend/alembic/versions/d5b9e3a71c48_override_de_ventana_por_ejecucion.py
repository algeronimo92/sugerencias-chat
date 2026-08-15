"""Autorización del admin para enviar con la ventana de 24 h cerrada.

Cuando una automatización intenta escribirle a un lead que hace más de 24 h
que no responde, la ejecución queda en `failed` y el admin recibe la alerta
"Automatización con error". Hasta acá esa alerta era terminal: reintentar
volvía a chocar contra el mismo guard, así que el envío no salía nunca.

Estas dos columnas registran que un admin autorizó *esa ejecución* a saltarse
el guard. Es un permiso puntual y auditado (quién y cuándo), no un permiso de
la regla: la siguiente ejecución de la misma automatización vuelve a
respetar la ventana.

Revision ID: d5b9e3a71c48
Revises: c4f8a2d91e60
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d5b9e3a71c48"
down_revision: Union[str, None] = "c4f8a2d91e60"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "automation_executions",
        sa.Column("window_override_by_user_id", sa.Integer(), nullable=True),
    )
    op.add_column(
        "automation_executions",
        sa.Column("window_override_at", sa.DateTime(timezone=True), nullable=True),
    )
    # SET NULL y no CASCADE: si se borra el usuario que autorizó, la ejecución
    # y su historial se conservan; solo se pierde a quién atribuirla.
    op.create_foreign_key(
        "fk_automation_executions_window_override_by",
        "automation_executions",
        "users",
        ["window_override_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "fk_automation_executions_window_override_by",
        "automation_executions",
        type_="foreignkey",
    )
    op.drop_column("automation_executions", "window_override_at")
    op.drop_column("automation_executions", "window_override_by_user_id")
