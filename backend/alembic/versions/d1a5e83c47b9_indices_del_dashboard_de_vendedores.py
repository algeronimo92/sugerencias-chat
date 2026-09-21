"""Índices para las agregaciones del dashboard de vendedores.

El dashboard dejó de ser admin-only y ahora agrupa por (usuario, fecha) en
tablas que solo tenían índices por lead o por fecha: sin estos, cada refresco
del panel escanea appointments, automation_executions, lead_tag_assignments y
lead_activity completas.

Revision ID: d1a5e83c47b9
Revises: b7d4e19a3f52
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "d1a5e83c47b9"
down_revision: Union[str, None] = "b7d4e19a3f52"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "idx_appointments_creator_created",
        "appointments",
        ["created_by_user_id", sa.text("created_at DESC")],
    )
    # Parcial: started_by_user_id solo se llena en los disparos manuales, que
    # son una fracción de las ejecuciones — el resto no aporta al índice.
    op.create_index(
        "idx_automation_executions_starter_created",
        "automation_executions",
        ["started_by_user_id", sa.text("created_at DESC")],
        postgresql_where=sa.text("started_by_user_id IS NOT NULL"),
    )
    op.create_index(
        "idx_lead_tag_assignments_assigned_at",
        "lead_tag_assignments",
        [sa.text("assigned_at DESC")],
    )
    op.create_index(
        "idx_lead_activity_actor_created",
        "lead_activity",
        ["actor_user_id", sa.text("created_at DESC")],
        postgresql_where=sa.text("actor_user_id IS NOT NULL"),
    )


def downgrade() -> None:
    op.drop_index("idx_lead_activity_actor_created", table_name="lead_activity")
    op.drop_index("idx_lead_tag_assignments_assigned_at", table_name="lead_tag_assignments")
    op.drop_index("idx_automation_executions_starter_created", table_name="automation_executions")
    op.drop_index("idx_appointments_creator_created", table_name="appointments")
