"""Índice único parcial que impide dos ejecuciones manuales activas del mismo
flujo sobre el mismo lead.

Un SELECT previo no alcanza como guarda: dos requests concurrentes (doble
click, dos vendedores, un refresh accidental) pueden pasarlo antes de que
cualquiera de las dos llegue a insertar — el índice es lo único que Postgres
arbitra de forma atómica al momento del INSERT.

Acotado a start_source='manual' y a estados no terminales (scheduled,
running): los triggers de sistema ya dedupan por event_key fijo (ver
schedule_automation_event), y el vendedor puede volver a arrancar el mismo
flujo sobre el mismo lead una vez que la ejecución anterior llegó a un estado
terminal (completed, failed, skipped).

Revision ID: b3d8f5c1a927
Revises: f3a7c9b1d284
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "b3d8f5c1a927"
down_revision: Union[str, None] = "f3a7c9b1d284"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_WHERE = "start_source = 'manual' AND status IN ('scheduled', 'running')"


def upgrade() -> None:
    op.create_index(
        "uq_automation_executions_manual_active_per_lead",
        "automation_executions",
        ["rule_id", "lead_id"],
        unique=True,
        postgresql_where=sa.text(_WHERE),
    )


def downgrade() -> None:
    op.drop_index(
        "uq_automation_executions_manual_active_per_lead",
        table_name="automation_executions",
        postgresql_where=sa.text(_WHERE),
    )
