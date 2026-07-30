"""flujos de inicio manual

Revision ID: 9f2b7c4d81a6
Revises: e7c2a9f04b13
Create Date: 2026-07-30

Soporte para que un vendedor dispare un flujo visual ("plantilla -> espera
fija -> cambio de etapa/tag") con un boton "Iniciar flujo" dentro del chat de
un lead puntual, en vez de que el motor solo arranque por eventos del sistema.

- `automation_rules.visible_to_sellers`: controla si un flujo visual con
  trigger_type='manual' aparece en el selector del vendedor. El admin
  siempre puede dispararlo desde el constructor aunque este en false.
- `automation_executions.start_source` / `started_by_user_id`: quien y como
  arranco la ejecucion. 'system' para los triggers automaticos de siempre,
  'manual' cuando la inicia un vendedor -- permite mostrar "Iniciado por Ana"
  y limitar la cancelacion a quien la lanzo.

Ninguna de las dos tablas esta en EXTERNAL_TABLES (ver alembic/env.py): son
propias de esta app, asi que se declaran con op.add_column normal en vez de
SQL a mano.
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "9f2b7c4d81a6"
down_revision: Union[str, None] = "e7c2a9f04b13"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "automation_rules",
        sa.Column("visible_to_sellers", sa.Boolean(), server_default="false", nullable=False),
    )
    op.add_column(
        "automation_executions",
        sa.Column("start_source", sa.Text(), server_default="system", nullable=False),
    )
    op.add_column(
        "automation_executions",
        sa.Column("started_by_user_id", sa.Integer(), nullable=True),
    )
    op.create_check_constraint(
        "ck_automation_executions_start_source",
        "automation_executions",
        "start_source IN ('system', 'manual')",
    )
    op.create_foreign_key(
        "automation_executions_started_by_user_id_fkey",
        "automation_executions",
        "users",
        ["started_by_user_id"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint(
        "automation_executions_started_by_user_id_fkey", "automation_executions", type_="foreignkey"
    )
    op.drop_constraint(
        "ck_automation_executions_start_source", "automation_executions", type_="check"
    )
    op.drop_column("automation_executions", "started_by_user_id")
    op.drop_column("automation_executions", "start_source")
    op.drop_column("automation_rules", "visible_to_sellers")
