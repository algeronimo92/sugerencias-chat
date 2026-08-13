"""Pausa de una sola ejecución, distinta de la pausa del lead entero.

Hasta acá el único freno reanudable era el botón del bot en la cabecera del
chat: congelaba de golpe todo lo que el sistema tenía programado sobre el lead.
`pause_scope` distingue quién congeló cada fila para que el botón de pausa de
una ejecución puntual (al lado de "Cancelar", en el panel del chat) y el del
lead no se pisen:

- 'lead': la congeló pausar el lead. `resume_lead_executions` la reanuda.
- 'execution': la congeló el vendedor sobre esa ejecución sola. Reanudar el
  lead no la toca; solo su propio botón la devuelve a la cola.

NULL es lo que dejaron las pausas previas a esta migración y se lee como
'lead' (`IS DISTINCT FROM 'execution'`), así que las filas ya congeladas
siguen reanudándose igual que antes.

El índice único parcial de flujos manuales activos pasa a incluir 'paused':
antes ninguna ejecución manual podía llegar a ese estado (ni la pausa del lead
ni el congelado del scheduler las tocan), y ahora que el vendedor puede
congelar una a mano, sin esto podría arrancar una segunda ejecución del mismo
flujo sobre el mismo lead y terminar con las dos corriendo en paralelo al
reanudar.

Revision ID: e9d3b7c21f48
Revises: b6e2d9a41f73
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "e9d3b7c21f48"
down_revision: Union[str, None] = "b6e2d9a41f73"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_MANUAL_ACTIVE_INDEX = "uq_automation_executions_manual_active_per_lead"


def upgrade() -> None:
    op.add_column(
        "automation_executions",
        sa.Column("pause_scope", sa.Text(), nullable=True),
    )
    # Lo que ya está congelado lo congeló la pausa del lead: marcarlo explícito
    # deja el dato legible sin depender de la lectura de NULL.
    op.execute(
        "UPDATE automation_executions SET pause_scope = 'lead' WHERE status = 'paused'"
    )
    op.drop_index(_MANUAL_ACTIVE_INDEX, table_name="automation_executions")
    op.create_index(
        _MANUAL_ACTIVE_INDEX,
        "automation_executions",
        ["rule_id", "lead_id"],
        unique=True,
        postgresql_where=sa.text(
            "start_source = 'manual' AND status IN ('scheduled', 'running', 'paused')"
        ),
    )


def downgrade() -> None:
    op.drop_index(_MANUAL_ACTIVE_INDEX, table_name="automation_executions")
    op.create_index(
        _MANUAL_ACTIVE_INDEX,
        "automation_executions",
        ["rule_id", "lead_id"],
        unique=True,
        postgresql_where=sa.text(
            "start_source = 'manual' AND status IN ('scheduled', 'running')"
        ),
    )
    # Las congeladas a mano no se pierden: sin la columna vuelven a leerse como
    # pausa del lead, así que reanudar el lead las devuelve a la cola.
    op.drop_column("automation_executions", "pause_scope")
