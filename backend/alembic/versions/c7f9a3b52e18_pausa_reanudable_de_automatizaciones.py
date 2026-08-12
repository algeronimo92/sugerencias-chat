"""Pausa reanudable de automatizaciones por lead.

Hasta acá, pausar un lead marcaba SKIPPED todo lo que tenía programado: un
estado terminal del que no se vuelve. El vendedor perdía el flujo entero
(incluido uno parado a mitad de camino en un bloque Pausa) y reanudar solo
habilitaba disparadores futuros — y ni siquiera los mismos, porque la fila
cancelada sigue ocupando su (rule_id, event_key) y ese evento no se vuelve a
crear nunca.

`paused_at` permite congelar en vez de cancelar: la ejecución pasa al estado
no terminal 'paused' conservando su scheduled_for, y al reanudar se le
devuelve el tiempo que le faltaba corriendo scheduled_for por lo que duró la
pausa. El scheduler no la toca mientras tanto porque solo levanta filas
'scheduled' (ver process_due_automation_executions).

La columna status es TEXT sin CHECK, así que el valor nuevo no necesita
migrar ningún tipo.

Revision ID: c7f9a3b52e18
Revises: d6a4e2f91b73
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op


revision: str = "c7f9a3b52e18"
down_revision: Union[str, None] = "d6a4e2f91b73"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "automation_executions",
        sa.Column("paused_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    # Las que estén congeladas vuelven a la cola antes de perder paused_at: si
    # no, quedarían en un estado que ya nadie sabe reanudar.
    op.execute(
        "UPDATE automation_executions SET status = 'scheduled', paused_at = NULL "
        "WHERE status = 'paused'"
    )
    op.drop_column("automation_executions", "paused_at")
